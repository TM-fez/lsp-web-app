/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * STAGE 1 — money & invoices, proven against real SQL.
 *
 *   1. Parallel payments on one booking cannot overpay (a REAL concurrency test: N
 *      simultaneous markPaid calls through the real service, real pool, real row locks).
 *   2. A part payment leaves exactly ONE open invoice and it equals the folio outstanding;
 *      settling never collects more than is owed.
 *   3. Every flow that creates money owed or received leaves a consistent invoice:
 *      pay-later confirm, the cockpit wizard's deposit, public /stay bookings, check-in/out.
 *   4. GET /invoices honours its filters; POST /invoices validates the booking.
 *   5. Availability is untouched by any of it (the money axis never decides who holds a room).
 *
 * Unit type CONFERENCE is reserved for this file: only one rate plan per unit type may be
 * active at once, so sharing a type with another suite makes both flaky.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';
import { QuotesService } from '../../../src/modules/quotes/quotes.service.js';
import { QuotesRepository } from '../../../src/modules/quotes/quotes.repository.js';
import { HoldsService } from '../../../src/modules/holds/holds.service.js';
import { HoldsRepository } from '../../../src/modules/holds/holds.repository.js';
import { PaymentsService } from '../../../src/modules/payments/payments.service.js';
import { PaymentsRepository } from '../../../src/modules/payments/payments.repository.js';
import { InvoicesService } from '../../../src/modules/invoices/invoices.service.js';
import { InvoicesRepository } from '../../../src/modules/invoices/invoices.repository.js';
import { FilesRepository } from '../../../src/modules/files/files.repository.js';
import { CheckinsService } from '../../../src/modules/checkins/checkins.service.js';
import { CheckinsRepository } from '../../../src/modules/checkins/checkins.repository.js';
import { PublicService } from '../../../src/modules/public/public.service.js';
import { PublicRepository } from '../../../src/modules/public/public.repository.js';
import { ContactsRepository } from '../../../src/modules/crm/contacts/contacts.repository.js';
import { LeadsRepository } from '../../../src/modules/crm/leads/leads.repository.js';
import { createWebsiteBookingExpiry } from '../../../src/modules/reservations/reservations.expiry.js';
import { runReceivablesBackfill } from '../../../src/modules/invoices/invoices.receivables-backfill.js';
import { runInvoiceBackfill } from '../../../src/modules/invoices/invoices.backfill.js';
import { ReportsRepository } from '../../../src/modules/reports/reports.repository.js';
import { todayInPropertyTZ } from '../../../src/core/time.js';
import { addDays } from '../../../src/modules/invoices/invoices.due.js';
import { lockReservation } from '../../../src/core/money/folio.js';
import { insertReceipt } from '../../../src/modules/invoices/invoices.receivable.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NIGHTLY = 150_000; // P1,500.00 a night
const STAY = NIGHTLY * 2; // every fixture booking is two nights, zero-rated

let userId: string;
let propA: string;
let propB: string;
let buildingA: string;
let buildingB: string;
let guestId: string;
let billerId: string;
let ratePlanId: string;
const roomIds: string[] = [];
const reservationIds: string[] = [];
const extraInvoiceIds: string[] = [];
let dayCursor = 40;

const meta = () => ({ userId, ip: '127.0.0.1', requestId: randomUUID() }) as never;

const pricing = new PricingService(new PricingRepository(db));
const quotes = new QuotesService(new QuotesRepository(db), pricing);
const holds = new HoldsService(new HoldsRepository(db), quotes);
const payments = new PaymentsService(new PaymentsRepository(db), new HoldsRepository(db), quotes);
const reservations = new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db), pricing, payments);
const invoices = new InvoicesService(new InvoicesRepository(db), quotes, new FilesRepository(db));
const invoicesRepo = new InvoicesRepository(db);

const dateOnly = (offset: number) => {
  const d = new Date(`${todayInPropertyTZ()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return new Date(d.toISOString().slice(0, 10));
};

/** A fresh unit + a two-night booking on it (own unit, so bookings never collide). */
async function booking(opts: {
  status?: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
  property?: 'A' | 'B';
  source?: 'WEBSITE' | 'DIRECT';
  folioTotal?: number | null;
  billing?: boolean;
  startOffset?: number;
} = {}) {
  const code = `S1-${uniq}-${roomIds.length}`;
  const room = await db.insertInto('rooms').values({
    name: `Stage1 ${roomIds.length}`, code, type: 'CONFERENCE', capacity: 4,
    building_id: opts.property === 'B' ? buildingB : buildingA, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow();
  roomIds.push(room.id);
  const start = opts.startOffset ?? (dayCursor += 5);
  const res = await db.insertInto('reservations').values({
    contact_id: guestId, room_id: room.id,
    check_in_date: dateOnly(start), check_out_date: dateOnly(start + 2),
    status: opts.status ?? 'PENDING', source: opts.source ?? 'DIRECT',
    billing_contact_id: opts.billing ? billerId : null,
    folio_total_amount: opts.folioTotal ?? null,
    created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow();
  reservationIds.push(res.id);
  return { id: res.id, roomId: room.id, code };
}

const invoicesOf = (reservationId: string) =>
  db.selectFrom('invoices').selectAll().where('reservation_id', '=', reservationId).orderBy('created_at', 'asc').orderBy('number', 'asc').execute();

const openOf = async (reservationId: string) =>
  (await invoicesOf(reservationId)).filter(
    (i) => (i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID') && i.kind !== 'REFUND' && i.deleted_at === null,
  );

/** Money received per the PAYMENTS side: PAID intents reaching this booking by hold or by invoice. */
async function paidIntentsTotal(reservationId: string): Promise<number> {
  const r = await sql<{ total: string }>`
    select coalesce(sum(pi.amount), 0) as total
    from payment_intents pi
    left join holds h on h.id = pi.hold_id
    left join invoices i on i.id = pi.invoice_id
    where pi.status = 'PAID' and coalesce(h.reservation_id, i.reservation_id) = ${reservationId}
  `.execute(db);
  return Number(r.rows[0]!.total);
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users')
    .values({ role_id: role.id, name: 'Stage1 Test', email: `s1-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;

  const props = await db.insertInto('properties')
    .values([{ name: `S1_PROP_A_${uniq}` }, { name: `S1_PROP_B_${uniq}` }])
    .returning(['id', 'name']).execute();
  propA = props.find((p) => p.name.includes('_A_'))!.id;
  propB = props.find((p) => p.name.includes('_B_'))!.id;
  const buildings = await db.insertInto('buildings')
    .values([{ property_id: propA, name: `S1_BLDG_A_${uniq}` }, { property_id: propB, name: `S1_BLDG_B_${uniq}` }])
    .returning(['id', 'property_id']).execute();
  buildingA = buildings.find((b) => b.property_id === propA)!.id;
  buildingB = buildings.find((b) => b.property_id === propB)!.id;

  // Zero-rated: the advertised rate IS the price paid, so the arithmetic below is plain.
  ratePlanId = (await db.insertInto('rate_plans').values({
    unit_type: 'CONFERENCE', name: `S1 Rate ${uniq}`,
    nightly_rate: NIGHTLY, weekly_rate: NIGHTLY * 6, monthly_rate: NIGHTLY * 24,
    max_guests: 4, deposit_pct: 50, tax_rate_bps: 0, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;

  const contacts = await db.insertInto('contacts').values([
    { name: `Stage One Guest ${uniq}`, email: `s1g-${uniq}@test.local`, created_by: userId, updated_by: userId },
    { name: `Stage One Biller ${uniq}`, company: 'S1 Co', email: `s1b-${uniq}@test.local`, created_by: userId, updated_by: userId },
  ]).returning(['id', 'name']).execute();
  guestId = contacts.find((c) => c.name.includes('Guest'))!.id;
  billerId = contacts.find((c) => c.name.includes('Biller'))!.id;
});

afterAll(async () => {
  const resIds = reservationIds;
  const invIds = [
    ...extraInvoiceIds,
    ...(resIds.length ? (await db.selectFrom('invoices').select('id').where('reservation_id', 'in', resIds).execute()).map((i) => i.id) : []),
  ];
  const holdIds = resIds.length ? (await db.selectFrom('holds').select('id').where('reservation_id', 'in', resIds).execute()).map((h) => h.id) : [];
  const intentIds = [
    ...(holdIds.length ? (await db.selectFrom('payment_intents').select('id').where('hold_id', 'in', holdIds).execute()).map((i) => i.id) : []),
    ...(invIds.length ? (await db.selectFrom('payment_intents').select('id').where('invoice_id', 'in', invIds).execute()).map((i) => i.id) : []),
  ];
  if (intentIds.length) {
    await db.deleteFrom('payment_attempts').where('payment_intent_id', 'in', intentIds).execute();
    await db.deleteFrom('payment_intents').where('id', 'in', intentIds).execute();
  }
  if (invIds.length) await db.deleteFrom('invoices').where('id', 'in', invIds).execute();
  if (holdIds.length) await db.deleteFrom('holds').where('id', 'in', holdIds).execute();
  if (resIds.length) {
    await db.deleteFrom('housekeeping_tasks').where('room_id', 'in', roomIds).execute();
    await db.deleteFrom('occupancy').where('reservation_id', 'in', resIds).execute();
    await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  }
  await db.deleteFrom('quotes').where('rate_plan_id', '=', ratePlanId).execute();
  await db.deleteFrom('rate_plans').where('id', '=', ratePlanId).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('building_id', 'in', [buildingA, buildingB]).execute();
  await db.deleteFrom('contacts').where('id', 'in', [guestId, billerId]).execute();
  await db.deleteFrom('buildings').where('id', 'in', [buildingA, buildingB]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propA, propB]).execute();
  // Contacts created by the public-booking test.
  await db.deleteFrom('contacts').where('email', 'like', `%${uniq}@public.local`).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('1. Parallel payments cannot overpay (real concurrency)', () => {
  // Both shapes matter: an unfrozen booking is also serialised by the first payment’s
  // write to the folio total, but a FROZEN one (pay-later confirmed, or already part-paid)
  // has no such write — only the booking lock stands between two parallel payments.
  it.each([
    ['an unpriced booking', null],
    ['a booking whose price is already frozen', STAY],
  ])('lets exactly ONE of six simultaneous full payments through (%s)', async (_label, folioTotal) => {
    const b = await booking({ folioTotal });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => reservations.markPaid(b.id, { method: 'CASH' } as never, meta())),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(5);
    // A clear, user-facing refusal — not a 500, not a constraint name.
    for (const f of failed) expect(String(f.reason.message)).toMatch(/already paid in full/);

    const folio = await reservations.getFolio(b.id);
    expect(folio.paid_amount).toBe(STAY);          // never more than the stay
    expect(folio.outstanding_amount).toBe(0);
    expect(await paidIntentsTotal(b.id)).toBe(STAY);
    const all = await invoicesOf(b.id);
    expect(all.filter((i) => i.status === 'PAID')).toHaveLength(1);
    expect(await openOf(b.id)).toHaveLength(0);     // nothing left to chase
  });

  // The service-level tests above are staggered by their own async pre-checks, so on a fast
  // machine a late request can simply SEE the first one's commit. This one removes the
  // pre-checks: N transactions start together and nothing but the transaction itself
  // (the booking lock, the cap re-checked inside settlePaid, the one-live-hold-per-unit index)
  // can stop an overpayment.
  it.each([2, 8])('%i simultaneous recorder transactions, pre-checks bypassed, still take the money once', async (n) => {
    const b = await booking({ folioTotal: STAY });
    const paymentsRepo = new PaymentsRepository(db);
    const quote = await quotes.prepareQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(700), check_out: dateOnly(702), guests: 1 }, meta());

    const results = await Promise.allSettled(
      Array.from({ length: n }, () =>
        paymentsRepo.recordDeskPayment(
          {
            reservationId: b.id, roomId: b.roomId, quote, pricedTotal: STAY, amount: undefined,
            method: 'CASH', reference: null, note: null, holdTtlMs: 60_000,
          },
          meta(),
        ),
      ),
    );

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const f of failures) expect(String(f.reason.message)).toMatch(/already paid in full/);
    expect((await reservations.getFolio(b.id)).paid_amount).toBe(STAY);
    expect(await paidIntentsTotal(b.id)).toBe(STAY);
  });

  // The DETERMINISTIC proof that the booking lock is what serialises money. Racing
  // requests only sometimes interleave badly, so a lucky run proves nothing; this holds the
  // lock open from outside, starts a payment, shows it is parked behind the lock, lets a
  // "competing payment" commit, and then shows the parked one saw it. With the FOR NO KEY
  // UPDATE removed from lockReservation the payment is NOT parked and this test fails.
  it.each([
    // No amount given: it takes the balance AS RE-READ UNDER THE LOCK (50k), not the 200k it
    // saw before queueing — so the booking ends exactly paid, never over.
    ['a desk payment', (id: string) => reservations.markPaid(id, { method: 'CASH' } as never, meta()), null],
    ['settling the open invoice', async (id: string) => {
      const [open] = await openOf(id);
      return invoices.settleInvoice(open!.id, null, meta());
    }, /would collect too much|already paid/],
  ] as Array<[string, (id: string) => Promise<unknown>, RegExp | null]>)('%s waits behind the booking lock and then sees what the lock holder committed', async (_label, act, refusal) => {
    const b = await booking({ folioTotal: STAY });
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());   // 200k open, 100k paid
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let holding!: () => void;
    const holdingLock = new Promise<void>((resolve) => { holding = resolve; });

    const holder = db.transaction().execute(async (trx) => {
      await lockReservation(trx, b.id);
      holding();
      await gate;
      // A competing payment of the WHOLE balance lands while we hold the lock.
      await insertReceipt(trx, {
        reservationId: b.id, holdId: null, quoteId: null, kind: 'BALANCE', amount: 150_000, taxRateBps: 0, currency: 'BWP',
      }, meta());
    });
    await holdingLock;

    let outcome: unknown = 'pending';
    const attempt = act(b.id).then(() => { outcome = 'paid'; }, (e) => { outcome = e; });
    await sleep(600);
    expect(outcome).toBe('pending');             // parked behind the lock, not racing past it

    release();
    await holder;
    await attempt;
    // Outstanding is now 50k; the parked request re-read the folio under the lock.
    if (refusal) {
      // A fixed 200k invoice no longer fits in the 50k that is left: refused, nothing collected.
      expect(outcome).not.toBe('paid');
      expect(String((outcome as Error).message)).toMatch(refusal);
      expect((await reservations.getFolio(b.id)).paid_amount).toBe(250_000);   // 100k + the competitor's 150k
    } else {
      // An open-ended payment adapts to the live balance: 50k, so the booking ends exactly paid.
      expect(outcome).toBe('paid');
      expect((await reservations.getFolio(b.id)).paid_amount).toBe(STAY);
      expect(await openOf(b.id)).toHaveLength(0);
    }
  });

  // The two paths that DON'T share a hold: settling the open invoice from the Invoices page
  // and taking the same balance at the desk. Each reads "what is owed" and each would collect
  // it; the booking lock is what makes the loser see the winner. Repeated, because a race
  // that happens to lose the coin-toss once proves nothing.
  it('the Invoices page and the desk cannot BOTH collect the same balance', async () => {
    for (let round = 0; round < 6; round++) {
      const b = await booking();
      await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
      const [open] = await openOf(b.id);

      const results = await Promise.allSettled([
        invoices.settleInvoice(open!.id, null, meta()),
        reservations.markPaid(b.id, { method: 'CASH' } as never, meta()),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const folio = await reservations.getFolio(b.id);
      expect(folio.paid_amount).toBe(STAY);                 // never STAY + 200_000
      expect(await paidIntentsTotal(b.id)).toBe(STAY);
      expect(await openOf(b.id)).toHaveLength(0);
    }
  });

  it('refuses the second of two simultaneous 60% payments as an overpayment', async () => {
    const b = await booking({ folioTotal: STAY });
    const sixty = STAY * 0.6;
    const results = await Promise.allSettled([
      reservations.markPaid(b.id, { method: 'CASH', amount: sixty } as never, meta()),
      reservations.markPaid(b.id, { method: 'EFT', amount: sixty } as never, meta()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect(String(rejected.reason.message)).toMatch(/more than this booking still owes/);
    expect(String(rejected.reason.message)).toMatch(/Outstanding: P1,200\.00/);

    const folio = await reservations.getFolio(b.id);
    expect(folio.paid_amount).toBe(sixty);
    expect(await paidIntentsTotal(b.id)).toBe(sixty);
  });

  it('lets four simultaneous quarter payments ALL land, summing to exactly the total', async () => {
    const b = await booking();
    const quarter = STAY / 4;
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => reservations.markPaid(b.id, { method: 'CASH', amount: quarter } as never, meta())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);

    const folio = await reservations.getFolio(b.id);
    expect(folio.paid_amount).toBe(STAY);
    expect(folio.payment_state).toBe('PAID');
    expect(await paidIntentsTotal(b.id)).toBe(STAY);
    expect(await openOf(b.id)).toHaveLength(0);
    expect((await invoicesOf(b.id)).filter((i) => i.status === 'PAID')).toHaveLength(4);
  });

  it('refuses a second SUCCESS attempt on an intent that is already paid', async () => {
    const b = await booking();
    const quote = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(200), check_out: dateOnly(202), guests: 1 }, meta());
    const hold = await holds.createHold({ quote_id: quote.id, room_id: b.roomId, reservation_id: b.id } as never, meta());
    const intent = await payments.createIntent({ hold_id: hold.id, method: 'CASH', purpose: 'DEPOSIT' } as never, meta());

    const results = await Promise.allSettled([
      payments.attempt(intent.id, { outcome: 'SUCCESS' } as never, meta()),
      payments.attempt(intent.id, { outcome: 'SUCCESS' } as never, meta()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await paidIntentsTotal(b.id)).toBe(quote.deposit_amount);
    expect((await invoicesOf(b.id)).filter((i) => i.status === 'PAID')).toHaveLength(1);
  });

  it('refuses a payment that completes after the booking was cancelled', async () => {
    const b = await booking();
    const quote = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(210), check_out: dateOnly(212), guests: 1 }, meta());
    const hold = await holds.createHold({ quote_id: quote.id, room_id: b.roomId, reservation_id: b.id } as never, meta());
    const intent = await payments.createIntent({ hold_id: hold.id, method: 'CASH', purpose: 'DEPOSIT' } as never, meta());
    await db.updateTable('reservations').set({ status: 'CANCELLED' }).where('id', '=', b.id).execute();

    await expect(payments.attempt(intent.id, { outcome: 'SUCCESS' } as never, meta())).rejects.toThrow(/cancelled booking/);
    expect(await paidIntentsTotal(b.id)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// Re-test round 3: the cockpit wizard leaves a live hold; "confirm, money still owed" and
// paying later at the desk then failed with a raw duplicate-key error (issue #110).
describe('1b. Pay later after the cockpit wizard (#110)', () => {
  async function wizardBooking(start: number) {
    const b = await booking({ startOffset: start });
    const quote = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(start), check_out: dateOnly(start + 2), guests: 1 }, meta());
    const hold = await holds.createHold({ quote_id: quote.id, room_id: b.roomId, reservation_id: b.id } as never, meta());
    const intent = await payments.createIntent({ hold_id: hold.id, method: 'CASH', purpose: 'DEPOSIT' } as never, meta());
    return { b, hold, intent };
  }

  it('confirm without payment, then pay at the desk: the money lands, the wizard hold is let go', async () => {
    const { b, hold, intent } = await wizardBooking(400);
    await reservations.confirmWithoutPayment(b.id, {} as never, meta());

    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());

    const folio = await reservations.getFolio(b.id);
    expect(folio).toMatchObject({ paid_amount: STAY, outstanding_amount: 0 });
    const oldHold = await db.selectFrom('holds').select(['status', 'release_reason']).where('id', '=', hold.id).executeTakeFirstOrThrow();
    expect(oldHold).toEqual({ status: 'RELEASED', release_reason: 'superseded_by_desk_payment' });
    // The wizard's unpaid attempt no longer reads "Awaiting" on the Payments page.
    expect((await payments.getIntent(intent.id)).status).toBe('EXPIRED');
  });

  it('a live hold on one booking no longer stops another booking of the same unit, other dates, from being paid', async () => {
    const { b } = await wizardBooking(410);
    const other = await booking({ startOffset: 420 });
    // Same unit as `b`: move `other` onto b's room for this check.
    await db.updateTable('reservations').set({ room_id: b.roomId }).where('id', '=', other.id).execute();
    await reservations.markPaid(other.id, { method: 'CASH' } as never, meta());
    expect((await reservations.getFolio(other.id)).outstanding_amount).toBe(0);
  });

  it('cancelling a booking releases its live hold', async () => {
    const { b, hold } = await wizardBooking(430);
    await reservations.cancelReservation(b.id, meta());
    const h = await db.selectFrom('holds').select(['status', 'release_reason']).where('id', '=', hold.id).executeTakeFirstOrThrow();
    expect(h).toEqual({ status: 'RELEASED', release_reason: 'booking_cancelled' });
  });

  it('refuses money on a hold with no booking behind it', async () => {
    const b = await booking({ startOffset: 440 });
    const quote = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(440), check_out: dateOnly(442), guests: 1 }, meta());
    const hold = await holds.createHold({ quote_id: quote.id, room_id: b.roomId } as never, meta());
    await expect(payments.createIntent({ hold_id: hold.id, method: 'CASH', purpose: 'DEPOSIT' } as never, meta()))
      .rejects.toThrow(/isn’t attached to a booking/);
    // A bare hold is invisible to afterAll's by-booking cleanup; remove it here.
    await db.deleteFrom('holds').where('id', '=', hold.id).execute();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('2. Part payments, the open balance invoice, and settling', () => {
  it('keeps ONE open invoice across part payments, equal to the folio outstanding, PARTIALLY_PAID', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());

    let open = await openOf(b.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.status).toBe('PARTIALLY_PAID');
    expect(open[0]!.total_amount).toBe(STAY - 100_000);
    const firstOpenId = open[0]!.id;

    await reservations.markPaid(b.id, { method: 'EFT', amount: 50_000 } as never, meta());
    open = await openOf(b.id);
    // Not a second invoice stacked on the first (the old behaviour doubled the receivable):
    // the same document, resized to what is still owed.
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(firstOpenId);
    expect(open[0]!.total_amount).toBe(STAY - 150_000);
    expect(open[0]!.status).toBe('PARTIALLY_PAID');
    expect((await reservations.getFolio(b.id)).outstanding_amount).toBe(open[0]!.total_amount);
    expect(open[0]!.due_date).not.toBeNull();
  });

  it('measures what is owed by the FOLIO, not by today’s re-priced total', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
    // The rate card moves after the price was agreed.
    await db.updateTable('rate_plans').set({ nightly_rate: NIGHTLY * 3 }).where('id', '=', ratePlanId).execute();
    try {
      await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    } finally {
      await db.updateTable('rate_plans').set({ nightly_rate: NIGHTLY }).where('id', '=', ratePlanId).execute();
    }
    const folio = await reservations.getFolio(b.id);
    expect(folio.total_amount).toBe(STAY);           // frozen at first contact with money
    expect(folio.paid_amount).toBe(STAY);            // took the folio balance (200k), not 800k
    expect(await openOf(b.id)).toHaveLength(0);
  });

  it('retires the open invoice (VOID, not delete) when the booking is paid in full', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
    const [open] = await openOf(b.id);
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());

    const after = (await invoicesOf(b.id)).find((i) => i.id === open!.id)!;
    expect(after.deleted_at).toBeNull();
    // Resized in place and then retired as unneeded: the booking is paid, so nothing is owed.
    expect(['VOID', 'PAID']).toContain(after.status);
    expect(await openOf(b.id)).toHaveLength(0);
  });

  it('settling the open invoice collects exactly what is owed and records a payment both pages show', async () => {
    const b = await booking({ billing: true });
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
    const [open] = await openOf(b.id);

    const settled = await invoices.settleInvoice(open!.id, null, meta());
    expect(settled.status).toBe('PAID');

    const folio = await reservations.getFolio(b.id);
    expect(folio.paid_amount).toBe(STAY);
    expect(folio.outstanding_amount).toBe(0);
    expect(await openOf(b.id)).toHaveLength(0);

    // The Payments page agrees: the settle left a PAID payment against the invoice…
    const intent = await db.selectFrom('payment_intents').selectAll().where('invoice_id', '=', open!.id).executeTakeFirstOrThrow();
    expect(intent).toMatchObject({ status: 'PAID', amount: STAY - 100_000, method: 'OTHER', invoice_id: open!.id });
    expect(await paidIntentsTotal(b.id)).toBe(folio.paid_amount);

    // …and the Payments list names the guest and unit even though this payment has no hold.
    const list = await new PaymentsRepository(db).findPaginated({ property_id: propA }, { page: 1, limit: 100 });
    const row = list.data.find((p) => p.id === intent.id);
    expect(row).toBeDefined();
    expect(row!.guest_name).toContain('Stage One Guest');
    expect(row!.unit_code).toBe(b.code);
    expect(row!.reservation_id).toBe(b.id);
    // …and is invisible from the other property.
    const other = await new PaymentsRepository(db).findPaginated({ property_id: propB }, { page: 1, limit: 100 });
    expect(other.data.some((p) => p.id === intent.id)).toBe(false);
  });

  it('refuses to settle a stale invoice that is larger than what the booking still owes', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
    // The legacy artefact: a leftover "balance" priced off the old re-quote, bigger than the folio balance.
    const stale = await db.insertInto('invoices').values({
      number: `S1-STALE-${Math.random().toString(36).slice(2, 8)}`, reservation_id: b.id, kind: 'BALANCE',
      status: 'ISSUED', subtotal_amount: STAY, tax_rate_bps: 0, tax_amount: 0, total_amount: STAY,
      issued_by: userId, created_by: userId, updated_by: userId,
    }).returning('id').executeTakeFirstOrThrow();

    await expect(invoices.settleInvoice(stale.id, null, meta())).rejects.toThrow(/would collect too much/);

    const after = await db.selectFrom('invoices').select('status').where('id', '=', stale.id).executeTakeFirstOrThrow();
    expect(after.status).toBe('ISSUED');
    expect((await reservations.getFolio(b.id)).paid_amount).toBe(100_000); // nothing was collected
  });

  it('collects once when the same invoice is settled twice at the same moment', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
    const [open] = await openOf(b.id);

    const results = await Promise.allSettled([
      invoices.settleInvoice(open!.id, null, meta()),
      invoices.settleInvoice(open!.id, null, meta()),
      invoices.settleInvoice(open!.id, null, meta()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await reservations.getFolio(b.id)).paid_amount).toBe(STAY);
    const intents = await db.selectFrom('payment_intents').select('id').where('invoice_id', '=', open!.id).execute();
    expect(intents).toHaveLength(1);
  });

  it('settling an invoice that has no hold or quote still records a payment the Payments page can place', async () => {
    const b = await booking({ billing: true });
    await reservations.confirmWithoutPayment(b.id, {} as never, meta());   // its invoice carries no hold/quote
    const [open] = await openOf(b.id);
    expect(open).toMatchObject({ hold_id: null, quote_id: null });

    await invoices.settleInvoice(open!.id, null, meta(), 'EFT');

    const intent = await db.selectFrom('payment_intents').selectAll().where('invoice_id', '=', open!.id).executeTakeFirstOrThrow();
    expect(intent).toMatchObject({ status: 'PAID', amount: STAY, method: 'EFT', hold_id: null, quote_id: null });
    const list = await new PaymentsRepository(db).findPaginated({ property_id: propA }, { page: 1, limit: 100 });
    const row = list.data.find((p) => p.id === intent.id)!;
    expect(row.guest_name).toContain('Stage One Guest');
    expect(row.reservation_id).toBe(b.id);
    expect(await paidIntentsTotal(b.id)).toBe(STAY);
    // And the attempt log records how it arrived.
    const attempts = await db.selectFrom('payment_attempts').select(['outcome', 'method']).where('payment_intent_id', '=', intent.id).execute();
    expect(attempts).toEqual([{ outcome: 'SUCCESS', method: 'EFT' }]);
  });

  it('a refund does not put the guest back in debt (owner decision 2026-10-02)', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    const receipt = (await invoicesOf(b.id)).find((i) => i.status === 'PAID')!;

    await invoices.refundInvoice(receipt.id, 100_000, 'goodwill after a noisy night', meta());

    const folio = await reservations.getFolio(b.id);
    expect(folio.paid_amount).toBe(STAY - 100_000);
    expect(folio.total_amount).toBe(STAY - 100_000);
    expect(folio.outstanding_amount).toBe(0);
    expect(await openOf(b.id)).toHaveLength(0);
  });

  it('a refund on a part-paid booking leaves what is still owed unchanged', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
    const receipt = (await invoicesOf(b.id)).find((i) => i.status === 'PAID')!;
    const before = await reservations.getFolio(b.id);

    await invoices.refundInvoice(receipt.id, 30_000, 'partial goodwill', meta());

    const after = await reservations.getFolio(b.id);
    expect(after.outstanding_amount).toBe(before.outstanding_amount);
    const open = await openOf(b.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.total_amount).toBe(after.outstanding_amount);
  });

  it('refunds once when the same receipt is refunded IN FULL twice at the same moment', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    const receipt = (await invoicesOf(b.id)).find((i) => i.status === 'PAID')!;

    // Since partial refunds (2026-10-04) two smaller refunds are both legitimate, so the
    // double click that must lose is the one asking for money that is no longer there.
    const results = await Promise.allSettled([
      invoices.refundInvoice(receipt.id, receipt.total_amount, 'double click', meta()),
      invoices.refundInvoice(receipt.id, receipt.total_amount, 'double click', meta()),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refunds = (await invoicesOf(b.id)).filter((i) => i.kind === 'REFUND');
    expect(refunds).toHaveLength(1);
    expect((await reservations.getFolio(b.id)).paid_amount).toBe(STAY - receipt.total_amount);
  });

  it('a partial refund leaves the receipt PAID; it can be refunded again up to what is left (owner decision 2026-10-04)', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    const receipt = (await invoicesOf(b.id)).find((i) => i.status === 'PAID')!;

    const first = await invoices.refundInvoice(receipt.id, 10_000, 'goodwill', meta());
    expect(first.refund_of_invoice_id).toBe(receipt.id);
    expect((await invoices.getInvoice(receipt.id)).status).toBe('PAID');

    // A credit note is not itself refundable.
    await expect(invoices.refundInvoice(first.id, 1_000, 'x', meta())).rejects.toThrow(/can’t itself be refunded/);

    // More than is left is refused, naming what is left.
    const left = receipt.total_amount - 10_000;
    await expect(invoices.refundInvoice(receipt.id, left + 1, 'too much', meta())).rejects.toThrow(/left to refund/);

    // The rest takes it to REFUNDED, and then nothing more can go back.
    await invoices.refundInvoice(receipt.id, left, 'rest', meta());
    expect((await invoices.getInvoice(receipt.id)).status).toBe('REFUNDED');
    await expect(invoices.refundInvoice(receipt.id, 1, 'again', meta())).rejects.toThrow(/refunded in full/);

    // Money: everything went back, and the guest owes nothing new (2026-10-02 rule).
    const folio = await reservations.getFolio(b.id);
    expect(folio.paid_amount).toBe(STAY - receipt.total_amount);
    expect(folio.outstanding_amount).toBe(0);
  });

  it('POST /invoices cannot invoice more than the booking owes, or a booking that is not in scope', async () => {
    const b = await booking();
    const quote = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(300), check_out: dateOnly(302), guests: 1 }, meta());
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
    // 200k owed and already invoiced (the open balance): another 100k would double-bill.
    await expect(
      invoices.issueInvoice({ quote_id: quote.id, kind: 'BALANCE', amount: 100_000, reservation_id: b.id } as never, meta(), propA),
    ).rejects.toThrow(/more than this booking still owes|already invoiced/);

    // Right property, plenty owed → fine, and it carries a due date.
    const c = await booking();
    const ok = await invoices.issueInvoice({ quote_id: quote.id, kind: 'BALANCE', amount: 100_000, reservation_id: c.id } as never, meta(), propA);
    expect(ok.status).toBe('ISSUED');
    expect(ok.due_date).not.toBeNull();

    // A booking in another property, a booking that does not exist: the same clean "not found".
    const inB = await booking({ property: 'B' });
    await expect(
      invoices.issueInvoice({ quote_id: quote.id, kind: 'BALANCE', amount: 100_000, reservation_id: inB.id } as never, meta(), propA),
    ).rejects.toThrow(/could not be found/);
    await expect(
      invoices.issueInvoice({ quote_id: quote.id, kind: 'BALANCE', amount: 100_000, reservation_id: '00000000-0000-4000-8000-000000000000' } as never, meta(), propA),
    ).rejects.toThrow(/could not be found/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('3. Every flow that creates money owed or received leaves a consistent invoice', () => {
  it('pay-later confirm raises an open invoice for the whole stay, due after check-in, voided on cancel', async () => {
    const b = await booking();
    await reservations.confirmWithoutPayment(b.id, { note: 'corporate account' } as never, meta());

    const open = await openOf(b.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: 'ISSUED', total_amount: STAY, kind: 'BALANCE' });
    const folio = await reservations.getFolio(b.id);
    expect(folio).toMatchObject({ total_amount: STAY, paid_amount: 0, outstanding_amount: STAY });
    // Due = the later of today and check-in, plus the terms (default 7 days).
    const checkIn = (await db.selectFrom('reservations').select(sql<string>`to_char(check_in_date,'YYYY-MM-DD')`.as('d')).where('id', '=', b.id).executeTakeFirstOrThrow()).d;
    const dueRow = await db.selectFrom('invoices').select(sql<string>`to_char(due_date,'YYYY-MM-DD')`.as('d')).where('id', '=', open[0]!.id).executeTakeFirstOrThrow();
    expect(dueRow.d).toBe(addDays(checkIn > todayInPropertyTZ() ? checkIn : todayInPropertyTZ(), 7));

    // The guest pays part later: the same invoice shrinks and becomes PARTIALLY_PAID.
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
    const after = await openOf(b.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(open[0]!.id);
    expect(after[0]).toMatchObject({ status: 'PARTIALLY_PAID', total_amount: STAY - 100_000 });
  });

  it('cancelling a booking voids what it owed (a cancelled stay is not chased)', async () => {
    const b = await booking();
    await reservations.confirmWithoutPayment(b.id, {} as never, meta());
    expect(await openOf(b.id)).toHaveLength(1);

    await reservations.cancelReservation(b.id, meta());

    expect(await openOf(b.id)).toHaveLength(0);
    const all = await invoicesOf(b.id);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe('VOID');
  });

  // Re-test 2026-10-04: Finance said 0 for a cancelled booking while its folio still
  // reported the whole stay as owed.
  it('a cancelled booking’s folio owes nothing, matching Finance', async () => {
    const b = await booking();
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());
    await reservations.cancelReservation(b.id, meta());
    const folio = await reservations.getFolio(b.id);
    expect(folio).toMatchObject({ paid_amount: 100_000, outstanding_amount: 0, credit_amount: 0 });
  });

  it('a no-show owes nothing — its open invoice is voided (owner decision 2026-10-02)', async () => {
    const b = await booking();
    await reservations.confirmWithoutPayment(b.id, {} as never, meta());
    expect(await openOf(b.id)).toHaveLength(1);

    await new ReservationsRepository(db).update(b.id, { status: 'NO_SHOW', updated_by: userId }, meta());

    expect(await openOf(b.id)).toHaveLength(0);
    expect((await invoicesOf(b.id)).map((i) => i.status)).toEqual(['VOID']);
  });

  it('the cockpit wizard’s deposit lands in the folio, raises a receipt, and is not collected twice', async () => {
    // What AssignBookingDrawer does: a PENDING booking, then quote → hold → intent → attempt.
    const b = await booking();
    const quote = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(400), check_out: dateOnly(402), guests: 1 }, meta());
    const hold = await holds.createHold({ quote_id: quote.id, room_id: b.roomId, reservation_id: b.id } as never, meta());
    const intent = await payments.createIntent({ hold_id: hold.id, method: 'CARD', purpose: 'DEPOSIT' } as never, meta());
    expect(intent.amount).toBe(STAY / 2); // the quote's 50% deposit
    const settled = await payments.attempt(intent.id, { outcome: 'SUCCESS' } as never, meta());

    expect(settled.status).toBe('PAID');
    expect(settled.invoice_id).toBeTruthy();
    const reservation = await db.selectFrom('reservations').select(['status', 'folio_total_amount']).where('id', '=', b.id).executeTakeFirstOrThrow();
    expect(reservation.status).toBe('CONFIRMED');
    expect(reservation.folio_total_amount).toBe(STAY);           // price agreed by the first money

    // The folio SEES the deposit — it used to read UNPAID, so the next "Mark paid" took it again.
    const folio = await reservations.getFolio(b.id);
    expect(folio).toMatchObject({ total_amount: STAY, paid_amount: STAY / 2, outstanding_amount: STAY / 2, payment_state: 'PART_PAID' });

    // Invoices: a PAID receipt linked to the intent, and ONE open invoice for the rest.
    const receipt = await db.selectFrom('invoices').selectAll().where('id', '=', settled.invoice_id!).executeTakeFirstOrThrow();
    expect(receipt).toMatchObject({ status: 'PAID', kind: 'DEPOSIT', total_amount: STAY / 2, reservation_id: b.id });
    const open = await openOf(b.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: 'PARTIALLY_PAID', total_amount: STAY / 2 });

    // The Payments page and the Invoices page agree on what was received.
    expect(await paidIntentsTotal(b.id)).toBe(folio.paid_amount);

    // No double collection: the next desk payment can only take the remaining half.
    await expect(reservations.markPaid(b.id, { method: 'CASH', amount: STAY } as never, meta())).rejects.toThrow(/more than this booking still owes/);
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    expect((await reservations.getFolio(b.id)).paid_amount).toBe(STAY);
    expect(await paidIntentsTotal(b.id)).toBe(STAY);
  });

  it('refuses a wizard payment larger than the quote, and a second deposit that would overpay', async () => {
    const b = await booking();
    const quote = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(410), check_out: dateOnly(412), guests: 1 }, meta());
    const hold = await holds.createHold({ quote_id: quote.id, room_id: b.roomId, reservation_id: b.id } as never, meta());
    await expect(
      payments.createIntent({ hold_id: hold.id, method: 'CASH', purpose: 'BALANCE', amount: STAY + 1 } as never, meta()),
    ).rejects.toThrow(/more than the quote total/);
    await holds.release(hold.id, 'test cleanup', meta()); // one live hold per unit

    // Booking already paid in full at the desk → a wizard-style settle on it must not collect again.
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    const quote2 = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(420), check_out: dateOnly(422), guests: 1 }, meta());
    const hold2 = await holds.createHold({ quote_id: quote2.id, room_id: b.roomId, reservation_id: b.id } as never, meta());
    const intent2 = await payments.createIntent({ hold_id: hold2.id, method: 'CASH', purpose: 'DEPOSIT' } as never, meta());
    await expect(payments.attempt(intent2.id, { outcome: 'SUCCESS' } as never, meta())).rejects.toThrow(/already paid in full/);
    expect((await reservations.getFolio(b.id)).paid_amount).toBe(STAY);
  });

  it('a public /stay booking is on the books at creation, and expiry voids it', async () => {
    // Offer only THIS file's units. reports-accrual.test.ts also creates CONFERENCE rooms
    // and runs in parallel, so the "first free unit of the type" was sometimes its room —
    // which that suite then deleted mid-test (an intermittent failure, ~1 run in 7).
    const publicRepo = new PublicRepository(db);
    const ownRooms = async (unitType: Parameters<PublicRepository['bookableRoomsByType']>[0]) =>
      (await PublicRepository.prototype.bookableRoomsByType.call(publicRepo, unitType)).filter((r) => roomIds.includes(r.id));
    publicRepo.bookableRoomsByType = ownRooms;
    const service = new PublicService(
      publicRepo,
      reservations,
      new ContactsRepository(db),
      new LeadsRepository(db),
    );
    const result = await service.createBooking(
      {
        unit_type: 'CONFERENCE', check_in: dateOnly(500), check_out: dateOnly(502), guests: 2,
        name: 'Web Guest', email: `web-${uniq}@public.local`, phone: '+26771000000',
      } as never,
      { ip: '127.0.0.1', requestId: null } as never,
    );
    reservationIds.push(result.reservation_id);

    const open = await openOf(result.reservation_id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: 'ISSUED', total_amount: STAY });
    const folio = await reservations.getFolio(result.reservation_id);
    expect(folio).toMatchObject({ total_amount: STAY, outstanding_amount: STAY, total_source: 'FOLIO' });

    // Age it past the TTL and run the real sweep: the booking is cancelled and what it owed is voided.
    await db.updateTable('reservations').set({ created_at: sql`now() - interval '72 hours'` }).where('id', '=', result.reservation_id).execute();
    const notify = vi.fn().mockResolvedValue(undefined);
    await createWebsiteBookingExpiry(db, { notify } as never)();

    const status = await db.selectFrom('reservations').select('status').where('id', '=', result.reservation_id).executeTakeFirstOrThrow();
    expect(status.status).toBe('CANCELLED');
    expect(await openOf(result.reservation_id)).toHaveLength(0);
  });

  it('check-in and check-out put an un-invoiced stay on the books exactly once', async () => {
    const checkins = new CheckinsService(new CheckinsRepository(db), reservations);
    const b = await booking({ status: 'CONFIRMED', startOffset: 0 });
    expect(await invoicesOf(b.id)).toHaveLength(0);

    const occupancy = await checkins.checkIn({ reservation_id: b.id, guest_count: 1 } as never, meta());
    let open = await openOf(b.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ status: 'ISSUED', total_amount: STAY });

    await checkins.checkOut(occupancy.id, {} as never, meta());
    open = await openOf(b.id);
    expect(open).toHaveLength(1);                       // not a second one
    expect((await invoicesOf(b.id))).toHaveLength(1);
    expect((await reservations.getFolio(b.id)).outstanding_amount).toBe(STAY);
  });

  it('a price-changing edit to an unpaid, pre-priced PENDING booking moves its invoice with it', async () => {
    const b = await booking({ source: 'WEBSITE', startOffset: 60 });
    await reservations.ensureReceivable(b.id, meta());
    expect((await openOf(b.id))[0]!.total_amount).toBe(STAY);

    await reservations.modifyReservation(b.id, { check_out_date: dateOnly(63) } as never, meta());

    const open = await openOf(b.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.total_amount).toBe(NIGHTLY * 3);
    expect((await reservations.getFolio(b.id)).total_amount).toBe(NIGHTLY * 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('4. GET /invoices honours the filters it is asked for', () => {
  const tag = `FLT${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const ids: Record<string, string> = {};
  let resA: { id: string; code: string };
  let resB: { id: string; code: string };

  const make = async (key: string, over: Record<string, unknown>) => {
    const row = await db.insertInto('invoices').values({
      number: `${tag}-${key}`, kind: 'BALANCE', status: 'ISSUED', subtotal_amount: 0, tax_rate_bps: 0, tax_amount: 0,
      total_amount: 10_000, issued_by: userId, created_by: userId, updated_by: userId, ...over,
    } as never).returning('id').executeTakeFirstOrThrow();
    ids[key] = row.id;
    extraInvoiceIds.push(row.id);
  };
  const run = async (filters: Record<string, unknown>) => {
    // Round 4: narrow every probe to this suite's own invoice numbers (`tag`), so the answer cannot
    // depend on how many other invoices the shared test database holds (house-wide ones such as
    // NOPROP match every property and used to be pushed off the first page).
    const page = await invoicesRepo.findPaginated({ search: tag, ...filters } as never, { page: 1, limit: 100 });
    return { ...page, mine: page.data.filter((r) => Object.values(ids).includes(r.id)).map((r) => r.number.slice(tag.length + 1)).sort() };
  };

  beforeAll(async () => {
    resA = await booking({ property: 'A', status: 'CONFIRMED' });
    resB = await booking({ property: 'B', status: 'CONFIRMED' });
    const today = todayInPropertyTZ();
    await make('OVERDUE', { reservation_id: resA.id, total_amount: 11_000, due_date: addDays(today, -4), created_at: sql`now() - interval '10 days'` });
    await make('PART', { reservation_id: resA.id, status: 'PARTIALLY_PAID', total_amount: 22_000, due_date: addDays(today, 6), created_at: sql`now() - interval '2 days'` });
    await make('PAID', { reservation_id: resA.id, status: 'PAID', total_amount: 33_000, created_at: sql`now() - interval '2 days'` });
    await make('VOID', { reservation_id: resA.id, status: 'VOID', total_amount: 44_000, due_date: addDays(today, -30) });
    await make('REFUND', { reservation_id: resA.id, kind: 'REFUND', status: 'PAID', total_amount: 1_000 });
    await make('OTHERP', { reservation_id: resB.id, total_amount: 55_000, due_date: addDays(today, -9) });
    await make('NOPROP', { total_amount: 6_600, due_date: addDays(today, -1) });
  });

  it('property_id: its own invoices + house-wide ones, never another property’s', async () => {
    expect((await run({ property_id: propA })).mine).toEqual(['NOPROP', 'OVERDUE', 'PAID', 'PART', 'REFUND', 'VOID']);
    expect((await run({ property_id: propB })).mine).toEqual(['NOPROP', 'OTHERP']);
  });

  it('outstanding: open (ISSUED + PARTIALLY_PAID) receivables only — not paid, void or refund', async () => {
    expect((await run({ property_id: propA, outstanding: true })).mine).toEqual(['NOPROP', 'OVERDUE', 'PART']);
  });

  // Re-test 2026-10-04: "Incoming" = owed but not late — the other half of "Unpaid".
  it('incoming: open and NOT yet overdue', async () => {
    expect((await run({ property_id: propA, incoming: true })).mine).toEqual(['PART']);
  });

  it('overdue: open AND past the due date, by the property calendar', async () => {
    const r = await run({ property_id: propA, overdue: true });
    expect(r.mine).toEqual(['NOPROP', 'OVERDUE']);
    const rows = r.data.filter((x) => ids.OVERDUE === x.id);
    expect(rows[0]).toMatchObject({ is_overdue: true });
    const part = (await run({ property_id: propA, outstanding: true })).data.find((x) => x.id === ids.PART)!;
    expect(part.is_overdue).toBe(false);
    expect(part.due_date).toBe(addDays(todayInPropertyTZ(), 6));
  });

  it('search: invoice number, guest name, unit code — and a % is not a wildcard', async () => {
    expect((await run({ property_id: propA, search: `${tag}-OVER` })).mine).toEqual(['OVERDUE']);
    expect((await run({ property_id: propA, search: 'stage one guest' })).data.some((d) => d.id === ids.OVERDUE)).toBe(true);
    expect((await run({ property_id: propA, search: resA.code })).mine).toEqual(['OVERDUE', 'PAID', 'PART', 'REFUND', 'VOID']);
    expect((await run({ property_id: propA, search: resB.code })).mine).toEqual([]);
    expect((await run({ property_id: propA, search: '%' })).mine).toEqual([]);
    expect((await run({ property_id: propA, search: '_' })).mine).toEqual([]);
  });

  it('from / to: filters by issue day (Africa/Gaborone), inclusive', async () => {
    const today = todayInPropertyTZ();
    const recent = await run({ property_id: propA, from: addDays(today, -5) });
    expect(recent.mine).toContain('PART');
    expect(recent.mine).not.toContain('OVERDUE'); // issued 10 days ago
    const old = await run({ property_id: propA, to: addDays(today, -5) });
    expect(old.mine).toEqual(['OVERDUE']);
    expect((await run({ property_id: propA, from: addDays(today, -11), to: addDays(today, -9) })).mine).toEqual(['OVERDUE']);
  });

  it('status and kind still work, and totals describe the whole view regardless of the status tab', async () => {
    expect((await run({ property_id: propA, status: 'PAID' })).mine).toEqual(['PAID', 'REFUND']);
    expect((await run({ property_id: propA, kind: 'REFUND' })).mine).toEqual(['REFUND']);

    const everything = await run({ property_id: propA });
    const paidTab = await run({ property_id: propA, status: 'PAID' });
    // Outstanding / overdue totals do not shrink to zero just because the PAID tab is open.
    expect(paidTab.totals).toEqual(everything.totals);
    const outstanding = await run({ property_id: propA, outstanding: true });
    expect(everything.totals.outstanding_count).toBe(outstanding.total);
    expect(everything.totals.outstanding_amount).toBeGreaterThanOrEqual(11_000 + 22_000 + 6_600);
    expect(everything.totals.overdue_amount).toBeGreaterThanOrEqual(11_000 + 6_600);
    expect(everything.totals.overdue_count).toBeLessThanOrEqual(everything.totals.outstanding_count);
  });

  it('pagination counts the filtered set, not the table', async () => {
    const page = await invoicesRepo.findPaginated({ property_id: propA, search: tag, outstanding: true } as never, { page: 1, limit: 2 });
    expect(page.total).toBe(3);
    expect(page.data).toHaveLength(2);
    const next = await invoicesRepo.findPaginated({ property_id: propA, search: tag, outstanding: true } as never, { page: 2, limit: 2 });
    expect(next.data).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('5. Availability is untouched by the money axis', () => {
  const reservationsRepo = new ReservationsRepository(db);

  it('a booking holds its dates whatever its invoices say: unpaid, part-paid, paid, or voided', async () => {
    const b = await booking({ source: 'WEBSITE', startOffset: 90 });
    const ci = dateOnly(90), co = dateOnly(92);
    expect(await reservationsRepo.checkAvailability(b.roomId, ci, co)).toBe(false);            // no invoice at all

    await reservations.ensureReceivable(b.id, meta());                                          // unpaid, invoiced
    expect(await reservationsRepo.checkAvailability(b.roomId, ci, co)).toBe(false);

    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, meta());   // part-paid
    expect(await reservationsRepo.checkAvailability(b.roomId, ci, co)).toBe(false);

    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());                     // paid in full
    expect(await reservationsRepo.checkAvailability(b.roomId, ci, co)).toBe(false);
  });

  it('cancelling voids the invoice AND frees the dates; no invoice state ever frees or blocks them on its own', async () => {
    const b = await booking({ startOffset: 100 });
    const ci = dateOnly(100), co = dateOnly(102);
    await reservations.confirmWithoutPayment(b.id, {} as never, meta());
    expect(await reservationsRepo.checkAvailability(b.roomId, ci, co)).toBe(false);

    // Voiding the invoice by hand does not release the room…
    await db.updateTable('invoices').set({ status: 'VOID' }).where('reservation_id', '=', b.id).execute();
    expect(await reservationsRepo.checkAvailability(b.roomId, ci, co)).toBe(false);
    // …cancelling the booking does.
    await reservations.cancelReservation(b.id, meta());
    expect(await reservationsRepo.checkAvailability(b.roomId, ci, co)).toBe(true);
  });

  it('a paid-and-checked-out stay frees its dates exactly as before', async () => {
    const checkins = new CheckinsService(new CheckinsRepository(db), reservations);
    const b = await booking({ status: 'CONFIRMED', startOffset: 0 });
    const occ = await checkins.checkIn({ reservation_id: b.id, guest_count: 1 } as never, meta());
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    await checkins.checkOut(occ.id, {} as never, meta());
    expect(await reservationsRepo.checkAvailability(b.roomId, dateOnly(0), dateOnly(2))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('6. The backfill brings legacy data into line (dry-run by default, idempotent)', () => {
  /** A booking as the OLD code left it: a receipt, then stacked stale ISSUED balances. */
  async function legacyPartPaid() {
    const b = await booking({ status: 'CONFIRMED', folioTotal: STAY });
    const mk = (status: string, kind: string, total: number, ago: number) =>
      db.insertInto('invoices').values({
        number: `S1-LEG-${Math.random().toString(36).slice(2, 9)}`, reservation_id: b.id, kind, status, subtotal_amount: total,
        tax_rate_bps: 0, tax_amount: 0, total_amount: total, issued_by: userId, created_by: userId, updated_by: userId,
        created_at: sql`now() - ${sql.raw(`interval '${ago} minutes'`)}`,
      } as never).returning('id').executeTakeFirstOrThrow();
    const receipt1 = await mk('PAID', 'DEPOSIT', 50_000, 30);
    const stale1 = await mk('ISSUED', 'BALANCE', 250_000, 29);   // 300k − 50k, issued after payment 1
    const receipt2 = await mk('PAID', 'DEPOSIT', 100_000, 20);
    const stale2 = await mk('ISSUED', 'BALANCE', 150_000, 19);   // stacked on top of stale1
    return { b, receipt1, stale1, receipt2, stale2 };
  }

  it('dry run reports but writes nothing; apply voids the surplus and resizes the survivor; re-run is a no-op', async () => {
    const { b, stale1, stale2 } = await legacyPartPaid();
    const before = await invoicesOf(b.id);

    const dry = await runReceivablesBackfill(db, { reservationIds: [b.id] });          // dryRun defaults to true
    expect(dry.changed).toBe(1);
    expect(dry.voided).toBe(1);
    expect(dry.resized).toBe(1);
    expect(dry.details[0]).toMatchObject({ reservation_id: b.id, total: STAY, paid: 150_000, outstanding: 150_000 });
    expect(await invoicesOf(b.id)).toEqual(before);                                       // not a byte changed

    const applied = await runReceivablesBackfill(db, { dryRun: false, reservationIds: [b.id] });
    expect(applied.failed).toEqual([]);
    const open = await openOf(b.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(stale1.id);                         // the oldest is kept (its age survives)…
    expect(open[0]).toMatchObject({ total_amount: 150_000, status: 'PARTIALLY_PAID' });
    const retired = (await invoicesOf(b.id)).find((i) => i.id === stale2.id)!;
    expect(retired.status).toBe('VOID');                          // …the rest are voided, never deleted
    expect((await reservations.getFolio(b.id)).outstanding_amount).toBe(150_000);

    const again = await runReceivablesBackfill(db, { dryRun: false, reservationIds: [b.id] });
    expect(again.changed).toBe(0);
    expect(again.in_agreement).toBe(1);
  });

  it('raises the missing invoice for a pay-later booking and for a wizard deposit with no folio total', async () => {
    const payLater = await booking({ status: 'CONFIRMED', folioTotal: STAY });                // no invoice at all
    // The wizard’s legacy shape: CONFIRMED, folio total NULL, a PAID intent against a quote, no receipt.
    const wiz = await booking({ status: 'CONFIRMED' });
    const quote = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(600), check_out: dateOnly(602), guests: 1 }, meta());
    const hold = await db.insertInto('holds').values({
      quote_id: quote.id, room_id: wiz.roomId, reservation_id: wiz.id, status: 'CONFIRMED', held_until: sql`now() + interval '1 day'`,
      created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow();
    const intent = await db.insertInto('payment_intents').values({
      hold_id: hold.id, quote_id: quote.id, purpose: 'DEPOSIT', amount: STAY / 2, currency: 'BWP', method: 'CARD',
      status: 'PAID', paid_at: sql`now()`, created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow();
    const receipt = await db.insertInto('invoices').values({
      number: `S1-LEGW-${Math.random().toString(36).slice(2, 9)}`, reservation_id: wiz.id, hold_id: hold.id, quote_id: quote.id,
      kind: 'DEPOSIT', status: 'PAID', subtotal_amount: STAY / 2, tax_rate_bps: 0, tax_amount: 0, total_amount: STAY / 2,
      issued_by: userId, created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow();
    await db.updateTable('payment_intents').set({ invoice_id: receipt.id }).where('id', '=', intent.id).execute();

    const run = await runReceivablesBackfill(db, { dryRun: false, reservationIds: [payLater.id, wiz.id] });
    expect(run.failed).toEqual([]);
    expect(run.created).toBe(2);

    expect((await openOf(payLater.id))[0]).toMatchObject({ status: 'ISSUED', total_amount: STAY });
    // The wizard booking: total taken from the quote it paid against (NOT from the receipt alone,
    // which would have said "fully paid"), so the other half is owed.
    expect((await openOf(wiz.id))[0]).toMatchObject({ status: 'PARTIALLY_PAID', total_amount: STAY / 2 });
    expect((await db.selectFrom('reservations').select('folio_total_amount').where('id', '=', wiz.id).executeTakeFirstOrThrow()).folio_total_amount).toBe(STAY);
    expect(await paidIntentsTotal(wiz.id)).toBe((await reservations.getFolio(wiz.id)).paid_amount);
  });

  it('lists a booking with no known price instead of guessing, prices it only on request, and flags overpayment', async () => {
    const unknown = await booking({ status: 'CHECKED_OUT' });                                  // no total, no invoices
    const dry = await runReceivablesBackfill(db, { reservationIds: [unknown.id] });
    expect(dry.needs_price.map((n) => n.reservation_id)).toEqual([unknown.id]);
    expect(await invoicesOf(unknown.id)).toHaveLength(0);
    await runReceivablesBackfill(db, { dryRun: false, reservationIds: [unknown.id] });
    expect(await invoicesOf(unknown.id)).toHaveLength(0);                                       // still untouched

    const priced = await runReceivablesBackfill(
      db,
      { dryRun: false, reconstructPrices: true, reservationIds: [unknown.id] },
      async () => ({ total: STAY, currency: 'BWP', taxRateBps: 0 }),
    );
    expect(priced.created).toBe(1);
    expect((await openOf(unknown.id))[0]).toMatchObject({ total_amount: STAY });

    const over = await booking({ status: 'CONFIRMED', folioTotal: 100_000 });
    await db.insertInto('invoices').values({
      number: `S1-OVR-${Math.random().toString(36).slice(2, 9)}`, reservation_id: over.id, kind: 'BALANCE', status: 'PAID',
      subtotal_amount: 130_000, tax_rate_bps: 0, tax_amount: 0, total_amount: 130_000, issued_by: userId, created_by: userId, updated_by: userId,
    } as never).execute();
    const report = await runReceivablesBackfill(db, { reservationIds: [over.id] });
    expect(report.overpaid).toEqual([{ reservation_id: over.id, total: 100_000, paid: 130_000 }]);
  });
});

describe('7. Receipt backfill: purged test payments and the date money arrived', () => {
  // A legacy paid intent with no receipt, as production has them: the money loop marked
  // the intent PAID and stopped. Paid on a fixed past day so the receipt date is checkable.
  async function legacyPaidIntent(reservationId: string, roomId: string, offset: number) {
    const quote = await quotes.createQuote({ unit_type: 'CONFERENCE', check_in: dateOnly(offset), check_out: dateOnly(offset + 2), guests: 1 }, meta());
    const hold = await holds.createHold({ quote_id: quote.id, room_id: roomId, reservation_id: reservationId } as never, meta());
    return (await db.insertInto('payment_intents').values({
      hold_id: hold.id, quote_id: quote.id, purpose: 'DEPOSIT', amount: 76_950, method: 'CASH',
      status: 'PAID', paid_at: new Date('2026-08-15T08:00:00Z'), created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  }

  it('skips payments on deleted (purged test) bookings, and dates real receipts the day money arrived', async () => {
    const real = await booking();
    const test = await booking();
    const realIntent = await legacyPaidIntent(real.id, real.roomId, 800);
    const testIntent = await legacyPaidIntent(test.id, test.roomId, 810);
    await db.updateTable('reservations').set({ deleted_at: new Date() }).where('id', '=', test.id).execute();

    const dry = await runInvoiceBackfill(db, { intentIds: [realIntent, testIntent] });
    expect(dry.details.find((d) => d.payment_intent_id === testIntent)).toMatchObject({ action: 'skip', reason: 'booking deleted' });
    expect(dry.details.find((d) => d.payment_intent_id === realIntent)).toMatchObject({ action: 'create', paid_on: '2026-08-15' });

    const applied = await runInvoiceBackfill(db, { dryRun: false, intentIds: [realIntent, testIntent] });
    expect(applied.created).toBe(1);

    const testRow = await db.selectFrom('payment_intents').select('invoice_id').where('id', '=', testIntent).executeTakeFirstOrThrow();
    expect(testRow.invoice_id).toBeNull();
    const realRow = await db.selectFrom('payment_intents').select('invoice_id').where('id', '=', realIntent).executeTakeFirstOrThrow();
    const receipt = await db.selectFrom('invoices').select(['status', 'total_amount', 'created_at']).where('id', '=', realRow.invoice_id!).executeTakeFirstOrThrow();
    expect(receipt).toMatchObject({ status: 'PAID', total_amount: 76_950 });
    expect(receipt.created_at.toISOString()).toBe('2026-08-15T08:00:00.000Z');

    // And the Payments page no longer lists the purged one.
    const list = await new PaymentsRepository(db).findPaginated({}, { page: 1, limit: 100 });
    const ids = list.data.map((p) => p.id);
    expect(ids).not.toContain(testIntent);
  });
});

describe('8. Stage 3: reports count refunds and cash by when it moved; edits move a confirmed price', () => {
  // Money is pinned to months no other suite touches (2041), so the property totals are ours.
  const at = (iso: string) => new Date(iso);
  const revenueIn = async (from: string, toExcl: string) => {
    const rows = await new ReportsRepository(db).revenueByProperty({ from, toExcl, propertyId: propA, accessiblePropertyIds: null });
    return Number(rows.find((r) => r.property_id === propA)?.amount ?? 0);
  };

  it('a refunded receipt reports what was kept (+P700 of P1,000), not −P300', async () => {
    const b = await booking({ startOffset: 900 });
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    const receipt = (await invoicesOf(b.id)).find((i) => i.status === 'PAID')!;
    await invoices.refundInvoice(receipt.id, 30_000, 'goodwill', meta());

    // Everything happened on 10 May 2041.
    await db.updateTable('invoices').set({ created_at: at('2041-05-10T08:00:00Z') }).where('reservation_id', '=', b.id).execute();
    await db.updateTable('payment_intents').set({ paid_at: at('2041-05-10T08:00:00Z') }).where('invoice_id', '=', receipt.id).execute();

    expect(await revenueIn('2041-05-01', '2041-06-01')).toBe(STAY - 30_000);
  });

  it('an invoice raised in one month and paid in a later one is cash in the month it was paid', async () => {
    const b = await booking({ startOffset: 910 });
    await reservations.confirmWithoutPayment(b.id, {} as never, meta());
    const open = (await openOf(b.id))[0]!;
    await db.updateTable('invoices').set({ created_at: at('2041-07-10T08:00:00Z') }).where('id', '=', open.id).execute();

    await invoices.settleInvoice(open.id, null, meta(), 'EFT');
    await db.updateTable('payment_intents').set({ paid_at: at('2041-09-15T08:00:00Z') }).where('invoice_id', '=', open.id).execute();

    expect(await revenueIn('2041-07-01', '2041-08-01')).toBe(0);
    expect(await revenueIn('2041-09-01', '2041-10-01')).toBe(STAY);
  });

  it('extending a CONFIRMED (unpaid) booking adds the extra night to what it owes', async () => {
    const b = await booking({ startOffset: 920 });
    await reservations.confirmWithoutPayment(b.id, {} as never, meta());
    expect((await reservations.getFolio(b.id)).total_amount).toBe(STAY);

    await reservations.modifyReservation(b.id, { check_out_date: dateOnly(923) } as never, meta());

    const folio = await reservations.getFolio(b.id);
    expect(folio.total_amount).toBe(STAY + NIGHTLY);
    const open = await openOf(b.id);
    expect(open).toHaveLength(1);
    expect(open[0]!.total_amount).toBe(STAY + NIGHTLY);
  });

  it('extending a fully PAID booking leaves exactly the new night owing', async () => {
    const b = await booking({ startOffset: 930 });
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    expect(await openOf(b.id)).toHaveLength(0);

    await reservations.modifyReservation(b.id, { check_out_date: dateOnly(933) } as never, meta());

    const folio = await reservations.getFolio(b.id);
    expect(folio).toMatchObject({ total_amount: STAY + NIGHTLY, paid_amount: STAY, outstanding_amount: NIGHTLY });
    const open = await openOf(b.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ total_amount: NIGHTLY, status: 'PARTIALLY_PAID' });
  });

  it('keeps an agreed price that differs from today’s rate card — only the changed nights move', async () => {
    const b = await booking({ startOffset: 940, status: 'CONFIRMED', folioTotal: 250_000 }); // negotiated, below 300k
    await reservations.modifyReservation(b.id, { check_out_date: dateOnly(943) } as never, meta());
    expect((await reservations.getFolio(b.id)).total_amount).toBe(250_000 + NIGHTLY);

    // Shortening by one night takes one night off again.
    await reservations.modifyReservation(b.id, { check_out_date: dateOnly(942) } as never, meta());
    expect((await reservations.getFolio(b.id)).total_amount).toBe(250_000);
  });

  // Re-test round 3: two edits at once both priced from the same stale "before" and the
  // second overwrote the first's total — a 4-night stay billed as 3.
  it('two date edits at the same moment leave the price matching the stay that won', async () => {
    for (let i = 0; i < 4; i++) {
      const start = 960 + i * 10;
      const b = await booking({ startOffset: start, status: 'CONFIRMED', folioTotal: STAY });
      await Promise.allSettled([
        reservations.modifyReservation(b.id, { check_out_date: dateOnly(start + 4) } as never, meta()),
        reservations.modifyReservation(b.id, { check_out_date: dateOnly(start + 3) } as never, meta()),
      ]);
      const row = await db.selectFrom('reservations').select(['check_in_date', 'check_out_date', 'folio_total_amount'])
        .where('id', '=', b.id).executeTakeFirstOrThrow();
      const nights = Math.round((new Date(row.check_out_date).getTime() - new Date(row.check_in_date).getTime()) / 86_400_000);
      expect(row.folio_total_amount).toBe(NIGHTLY * nights);
    }
  });

  // Re-test 2026-10-04: a paid stay shortened by a night showed "PAID" and nothing else.
  it('a paid stay shortened afterwards shows the refund due — and refunding it does not cut the price again', async () => {
    const b = await booking({ startOffset: 950 });
    await reservations.markPaid(b.id, { method: 'CASH' } as never, meta());
    await reservations.modifyReservation(b.id, { check_out_date: dateOnly(951) } as never, meta());

    const folio = await reservations.getFolio(b.id);
    expect(folio).toMatchObject({ total_amount: STAY - NIGHTLY, paid_amount: STAY, outstanding_amount: 0, credit_amount: NIGHTLY });

    // Handing the credit back settles what the house owes: the one-night price stands.
    const receipt = (await invoicesOf(b.id)).find((i) => i.status === 'PAID' && i.kind !== 'REFUND')!;
    await invoices.refundInvoice(receipt.id, NIGHTLY, 'shortened stay', meta());
    expect(await reservations.getFolio(b.id)).toMatchObject({
      total_amount: STAY - NIGHTLY, paid_amount: STAY - NIGHTLY, outstanding_amount: 0, credit_amount: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('Audit and numbering', () => {
  it('writes the receipt and the payment’s audit rows with the request id, and numbers invoices without gaps', async () => {
    const b = await booking();
    const requestId = randomUUID();
    const m = { userId, ip: '10.0.0.9', requestId } as never;
    await reservations.markPaid(b.id, { method: 'CASH', amount: 100_000 } as never, m);

    const receipt = (await invoicesOf(b.id)).find((i) => i.status === 'PAID')!;
    const audit = await db.selectFrom('audit_logs').select(['action', 'entity', 'request_id', 'ip_address'])
      .where('request_id', '=', requestId).execute();
    expect(audit.some((a) => a.entity === 'invoices' && a.action === 'CREATE')).toBe(true);
    expect(audit.some((a) => a.entity === 'payment_intents')).toBe(true);
    expect(audit.every((a) => a.ip_address === '10.0.0.9')).toBe(true);
    expect(receipt.number).toMatch(/^INV-/);
  });
});
