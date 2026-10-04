/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * ROUND 4 — concurrent date edits and discounts on one booking, with REAL concurrency
 * (Promise.all of N requests through the real service, real pool, real row locks).
 *
 * The bug: a date edit committed first and was re-priced afterwards in a second transaction,
 * from a stale folio, with a clip at zero. Two or more edits at once left the folio and the
 * open invoice billing nights nobody had — over AND under the price of the final dates.
 * Round 4 measured it at 10/10 wrong with 3 parallel edits.
 *
 * What must hold after ANY number of simultaneous edits:
 *     folio total  ==  open invoice(s)  ==  price recomputed for the FINAL dates
 * and every edit still leaves its audit row.
 *
 * Unit type STANDARD (serialised across suites with an advisory lock — only one active rate
 * plan per unit type may exist). The same discount race is covered for PENDING bookings.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/config/db.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';
import { QuotesService } from '../../../src/modules/quotes/quotes.service.js';
import { QuotesRepository } from '../../../src/modules/quotes/quotes.repository.js';
import { HoldsRepository } from '../../../src/modules/holds/holds.repository.js';
import { PaymentsService } from '../../../src/modules/payments/payments.service.js';
import { PaymentsRepository } from '../../../src/modules/payments/payments.repository.js';
import { InvoicesService } from '../../../src/modules/invoices/invoices.service.js';
import { InvoicesRepository } from '../../../src/modules/invoices/invoices.repository.js';
import { FilesRepository } from '../../../src/modules/files/files.repository.js';
import { todayInPropertyTZ } from '../../../src/core/time.js';
import { lockUnitType } from '../helpers/unitTypeLock.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NIGHTLY = 65_000;

let userId: string;
let propertyId: string;
let buildingId: string;
let guestId: string;
let ratePlanId: string;
let releaseUnitType: () => Promise<void>;
const roomIds: string[] = [];
const reservationIds: string[] = [];
let dayCursor = 20;

const meta = () => ({ userId, ip: '127.0.0.1', requestId: randomUUID() }) as never;

const pricing = new PricingService(new PricingRepository(db));
const quotes = new QuotesService(new QuotesRepository(db), pricing);
const payments = new PaymentsService(new PaymentsRepository(db), new HoldsRepository(db), quotes);
const reservations = new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db), pricing, payments);
const invoices = new InvoicesService(new InvoicesRepository(db), quotes, new FilesRepository(db));

const dateOnly = (offset: number) => {
  const d = new Date(`${todayInPropertyTZ()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return new Date(d.toISOString().slice(0, 10));
};

/** A fresh unit + a booking of `nights` nights on it; returns the booking and its first night offset. */
async function booking(nights: number, status: 'PENDING' | 'CONFIRMED' = 'PENDING') {
  const code = `CE-${uniq}-${roomIds.length}`;
  const room = await db.insertInto('rooms').values({
    name: `Concurrent ${roomIds.length}`, code, type: 'STANDARD', capacity: 2,
    building_id: buildingId, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow();
  roomIds.push(room.id);
  const start = (dayCursor += 40); // far apart: edits stretch a stay up to ~10 nights
  const res = await db.insertInto('reservations').values({
    contact_id: guestId, room_id: room.id,
    check_in_date: dateOnly(start), check_out_date: dateOnly(start + nights),
    status: 'PENDING', source: 'DIRECT', created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow();
  reservationIds.push(res.id);
  if (status === 'CONFIRMED') await reservations.confirmWithoutPayment(res.id, {} as never, meta());
  return { id: res.id, start };
}

const setNights = (b: { id: string; start: number }, nights: number) =>
  reservations.modifyReservation(b.id, { check_out_date: dateOnly(b.start + nights) } as never, meta());

/** The three numbers that must agree, plus the stay length they were measured against. */
async function money(id: string) {
  const folio = await reservations.getFolio(id);
  const priced = await reservations.priceReservation(id);
  if (!priced.priceable) throw new Error('fixture must be priceable');
  const open = await db.selectFrom('invoices').select('total_amount').where('reservation_id', '=', id)
    .where('deleted_at', 'is', null).where('kind', '<>', 'REFUND').where('status', 'in', ['ISSUED', 'PARTIALLY_PAID']).execute();
  return {
    stored: (await db.selectFrom('reservations').select('folio_total_amount').where('id', '=', id).executeTakeFirstOrThrow()).folio_total_amount,
    folio: folio.total_amount,
    paid: folio.paid_amount,
    outstanding: folio.outstanding_amount,
    openInvoices: open.reduce((n, i) => n + i.total_amount, 0),
    price: priced.total_amount,
  };
}

const editAudit = (id: string) =>
  db.selectFrom('audit_logs').select(['diff']).where('entity', '=', 'reservations').where('entity_id', '=', id).where('action', '=', 'UPDATE').execute();

beforeAll(async () => {
  releaseUnitType = await lockUnitType('STANDARD');
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users')
    .values({ role_id: role.id, name: 'Concurrent Test', email: `ce-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
  propertyId = (await db.insertInto('properties').values({ name: `CE_PROP_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  buildingId = (await db.insertInto('buildings').values({ property_id: propertyId, name: `CE_BLDG_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  // VAT-inclusive like the real rate cards, so the recomputed price is not a trivial multiple.
  ratePlanId = (await db.insertInto('rate_plans').values({
    unit_type: 'STANDARD', name: `CE Rate ${uniq}`,
    nightly_rate: NIGHTLY, weekly_rate: NIGHTLY * 6, monthly_rate: NIGHTLY * 24,
    max_guests: 2, deposit_pct: 50, tax_rate_bps: 1400, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `CE Guest ${uniq}`, email: `ce-${uniq}@test.local`, created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  try {
    if (reservationIds.length) {
      const inv = await db.selectFrom('invoices').select('id').where('reservation_id', 'in', reservationIds).execute();
      const invIds = inv.map((i) => i.id);
      const holdIds = (await db.selectFrom('holds').select('id').where('reservation_id', 'in', reservationIds).execute()).map((h) => h.id);
      const intents = [
        ...(holdIds.length ? (await db.selectFrom('payment_intents').select('id').where('hold_id', 'in', holdIds).execute()) : []),
        ...(invIds.length ? (await db.selectFrom('payment_intents').select('id').where('invoice_id', 'in', invIds).execute()) : []),
      ].map((i) => i.id);
      if (intents.length) {
        await db.deleteFrom('payment_attempts').where('payment_intent_id', 'in', intents).execute();
        await db.deleteFrom('payment_intents').where('id', 'in', intents).execute();
      }
      if (invIds.length) {
        await db.updateTable('invoices').set({ refund_of_invoice_id: null }).where('id', 'in', invIds).execute();
        await db.deleteFrom('invoices').where('id', 'in', invIds).execute();
      }
      if (holdIds.length) await db.deleteFrom('holds').where('id', 'in', holdIds).execute();
      await db.deleteFrom('revenue_recognition').where('reservation_id', 'in', reservationIds).execute();
      await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
    }
    await db.deleteFrom('quotes').where('rate_plan_id', '=', ratePlanId).execute();
    await db.deleteFrom('rate_plans').where('id', '=', ratePlanId).execute();
    await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
    await db.deleteFrom('rooms').where('building_id', '=', buildingId).execute();
    await db.deleteFrom('contacts').where('id', '=', guestId).execute();
    await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
    await db.deleteFrom('properties').where('id', '=', propertyId).execute();
    await db.deleteFrom('users').where('id', '=', userId).execute();
  } finally {
    await releaseUnitType();
  }
});

describe('parallel date edits on a CONFIRMED booking (the round-4 money bug)', () => {
  // The exact shapes round 4 found wrong: 2, 3, 4 and 6 simultaneous edits with different lengths.
  const shapes: Array<{ label: string; start: number; edits: number[] }> = [
    { label: '2 parallel edits', start: 2, edits: [3, 4] },
    { label: '3 parallel edits', start: 2, edits: [3, 4, 1] },
    { label: '4 parallel edits', start: 2, edits: [1, 2, 3, 4] },
    { label: '6 parallel edits', start: 2, edits: [2, 3, 4, 2, 3, 4] },
  ];
  const REPEATS = 6;

  for (const shape of shapes) {
    it(`${shape.label}: folio == open invoice == recomputed price of the final dates (×${REPEATS})`, async () => {
      for (let run = 0; run < REPEATS; run++) {
        const b = await booking(shape.start, 'CONFIRMED');
        const before = await money(b.id);
        expect(before.folio).toBe(before.price);

        const results = await Promise.all(shape.edits.map((n) => setNights(b, n).then(() => 'ok', (e: Error) => e.message)));
        expect(results.every((r) => r === 'ok'), `all edits are valid: ${JSON.stringify(results)}`).toBe(true);

        const m = await money(b.id);
        expect(m.folio, `run ${run} ${shape.label}`).toBe(m.price);
        expect(m.stored).toBe(m.price);
        expect(m.openInvoices).toBe(m.price);
        expect(m.outstanding).toBe(m.price);

        // Audit: one UPDATE per edit carrying the new check-out, and the price movements add up
        // to exactly (final − original) — no stale "from" figure applied twice.
        const audits = await editAudit(b.id);
        const dateEdits = audits.filter((a) => (a.diff as Record<string, unknown>)['check_out_date'] !== undefined);
        expect(dateEdits).toHaveLength(shape.edits.length);
        const moves = audits
          .map((a) => a.diff as { folio_total_amount?: number; from?: number; reason?: string })
          .filter((d) => d.reason === 'price adjusted for changed dates or unit');
        const net = moves.reduce((n, d) => n + (d.folio_total_amount! - d.from!), 0);
        expect(net).toBe(m.folio - before.folio);
      }
    }, 60_000);
  }

  it('part-paid booking: parallel edits keep paid + one open invoice == the price of the final dates', async () => {
    for (let run = 0; run < 3; run++) {
      const b = await booking(2, 'CONFIRMED');
      await reservations.markPaid(b.id, { method: 'CASH', amount: 50_000 } as never, meta());
      await Promise.all([3, 5, 1, 4].map((n) => setNights(b, n)));
      const m = await money(b.id);
      expect(m.folio).toBe(m.price);
      expect(m.paid).toBe(50_000);
      expect(m.openInvoices).toBe(m.price - 50_000);
    }
  }, 60_000);

  it('a fully paid booking that is lengthened and shortened in parallel ends consistent (credit, never a clipped total)', async () => {
    const b = await booking(3, 'CONFIRMED');
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta()); // paid in full for 3 nights
    await Promise.all([1, 5, 2, 4].map((n) => setNights(b, n)));
    const m = await money(b.id);
    expect(m.folio).toBe(m.price);
    const f = await reservations.getFolio(b.id);
    // Whatever the last edit was, the books are balanced: owed and credit are the two sides of one number.
    expect(f.outstanding_amount - f.credit_amount).toBe(m.price - m.paid);
    expect(m.openInvoices).toBe(f.outstanding_amount);
  }, 30_000);
});

describe('parallel date edits on an unpaid PENDING booking', () => {
  it('re-prices from the locked row: folio == invoice == price of the final dates (×6)', async () => {
    for (let run = 0; run < 6; run++) {
      const b = await booking(2, 'PENDING');
      // Freeze the price the way ensureReceivable does for a website booking.
      await reservations.ensureReceivable(b.id, meta());
      await Promise.all([3, 4, 1, 2].map((n) => setNights(b, n)));
      const m = await money(b.id);
      expect(m.folio).toBe(m.price);
      expect(m.openInvoices).toBe(m.price);
    }
  }, 60_000);
});

describe('sequential behaviour is unchanged', () => {
  it('extend then shorten a confirmed booking moves the price by exactly the difference each time', async () => {
    const b = await booking(2, 'CONFIRMED');
    const p2 = (await money(b.id)).price;
    await setNights(b, 4);
    const m4 = await money(b.id);
    expect(m4.folio).toBe(m4.price);
    expect(m4.price).toBeGreaterThan(p2);
    await setNights(b, 1);
    const m1 = await money(b.id);
    expect(m1.folio).toBe(m1.price);
    expect(m1.openInvoices).toBe(m1.price);
    await setNights(b, 2);
    expect((await money(b.id)).folio).toBe(p2);
  });

  it('keeps an agreed price that differs from today’s rate card: only the changed nights are re-priced', async () => {
    const b = await booking(2, 'CONFIRMED');
    const agreed = (await money(b.id)).folio;
    // The rate card goes up AFTER the guest agreed; the 2 agreed nights must not move.
    await db.updateTable('rate_plans').set({ nightly_rate: NIGHTLY + 10_000, weekly_rate: (NIGHTLY + 10_000) * 6, monthly_rate: (NIGHTLY + 10_000) * 24 }).where('id', '=', ratePlanId).execute();
    try {
      await setNights(b, 3);
      const m = await money(b.id);
      const oneNightToday = Math.round((NIGHTLY + 10_000) * 1.14);
      expect(m.folio).toBe(agreed + oneNightToday);
    } finally {
      await db.updateTable('rate_plans').set({ nightly_rate: NIGHTLY, weekly_rate: NIGHTLY * 6, monthly_rate: NIGHTLY * 24 }).where('id', '=', ratePlanId).execute();
    }
  });

  it('does not clip a negative price: an edit that would take the agreed total below zero is refused and rolled back', async () => {
    const b = await booking(4, 'CONFIRMED');
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    const paidInv = await db.selectFrom('invoices').select(['id', 'total_amount']).where('reservation_id', '=', b.id).where('status', '=', 'PAID').executeTakeFirstOrThrow();
    // Goodwill refund of nearly all of it lowers the agreed total (owner decision: a refund never re-bills the guest).
    await invoices.refundInvoice(paidInv.id, paidInv.total_amount - 20_000, 'goodwill', meta());
    const before = await db.selectFrom('reservations').select(['folio_total_amount', 'check_out_date']).where('id', '=', b.id).executeTakeFirstOrThrow();
    expect(before.folio_total_amount).toBe(20_000);

    await expect(setNights(b, 1)).rejects.toThrow(/below zero/);

    const after = await db.selectFrom('reservations').select(['folio_total_amount', 'check_out_date']).where('id', '=', b.id).executeTakeFirstOrThrow();
    expect(after.folio_total_amount).toBe(20_000);
    expect(after.check_out_date.getTime()).toBe(before.check_out_date.getTime()); // the dates did NOT change
  });
});

describe('parallel discounts on a PENDING booking (serialised, deterministic, audited)', () => {
  it('6 simultaneous discounts: each is applied and audited, and folio == invoice == price with the surviving discount (×10)', async () => {
    for (let run = 0; run < 10; run++) {
      const b = await booking(2, 'PENDING');
      await reservations.ensureReceivable(b.id, meta());
      const requests = [10, 20, 30, 40, 50, 60].map((v) =>
        reservations.setDiscount(b.id, { discount_type: 'PERCENT', discount_value: v, discount_reason: `r${v}` } as never, meta(), true),
      );
      const out = await Promise.all(requests);
      expect(out).toHaveLength(6);

      const row = await db.selectFrom('reservations').select(['discount_value', 'discount_reason']).where('id', '=', b.id).executeTakeFirstOrThrow();
      expect([10, 20, 30, 40, 50, 60]).toContain(row.discount_value);
      expect(row.discount_reason).toBe(`r${row.discount_value}`); // one request's fields, never a mix

      const m = await money(b.id);
      expect(m.price).toBeLessThan(Math.round(NIGHTLY * 2 * 1.14)); // the surviving discount is really in the price
      expect(m.folio).toBe(m.price);
      expect(m.openInvoices).toBe(m.price);

      const audits = (await editAudit(b.id)).map((a) => a.diff as Record<string, unknown>);
      expect(audits.filter((d) => d['discount_type'] === 'PERCENT')).toHaveLength(6);
    }
  }, 60_000);

  it('a discount racing a payment never lands on a booking the payment already confirmed', async () => {
    const b = await booking(2, 'PENDING');
    const [d, p] = await Promise.allSettled([
      reservations.setDiscount(b.id, { discount_type: 'PERCENT', discount_value: 50 } as never, meta(), true),
      reservations.markPaid(b.id, { method: 'CASH' } as never, meta()),
    ]);
    expect(p.status).toBe('fulfilled');
    const row = await db.selectFrom('reservations').select(['status', 'discount_value']).where('id', '=', b.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('CONFIRMED');
    if (d.status === 'rejected') {
      // Lost the race: refused cleanly, nothing recorded.
      expect(String((d.reason as Error).message)).toMatch(/pending booking/);
      expect(row.discount_value).toBeNull();
    }
    const m = await money(b.id);
    expect(m.paid).toBe(m.folio); // whatever was agreed was paid exactly
  });

  it('refuses a discount on a confirmed booking with the plain-English 409', async () => {
    const b = await booking(2, 'CONFIRMED');
    await expect(
      reservations.setDiscount(b.id, { discount_type: 'PERCENT', discount_value: 10 } as never, meta(), true),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/pending booking/) });
  });
});
