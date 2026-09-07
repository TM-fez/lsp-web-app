/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * The booking folio (migration 067) — the MONEY axis, against real SQL.
 *
 * Why this suite exists at all, rather than a unit test with a mocked repository:
 * the arithmetic that matters lives in SQL (ReservationsRepository.paidToDate), so a
 * mock would only assert that the mock returns what the mock was told to return.
 *
 * The case worth testing hardest is the refund, because the OBVIOUS query gets it
 * backwards. refundInvoice() marks the ORIGINAL invoice 'REFUNDED' and inserts a
 * SEPARATE positive row with kind='REFUND', status='PAID'. Summing `status = 'PAID'`
 * alone therefore drops the original from the positive side while keeping the refund
 * on the negative side — a P1,000 booking refunded P300 reads as MINUS P300 received
 * instead of P700. A REFUNDED invoice was still paid; the money really did arrive.
 *
 * Unit type DELUXE, and this suite claims it. `rate_plans_active_unit_type_unique` is a
 * partial unique index allowing only ONE active plan per unit type, so two suites
 * sharing a type collide the moment they run in the same pass — CUSTOM belongs to
 * mark-paid, STANDARD to everyone else. Choosing CUSTOM here made mark-paid fail
 * intermittently: order-dependent, so it passed alone and passed some full runs.
 *
 * Invoices are inserted directly rather than driven through markPaid. That is
 * deliberate — this suite is about how the folio READS invoices, and hand-built rows
 * let it stage shapes (a bare ISSUED invoice, a soft-deleted one, a partial refund)
 * that the write path cannot currently produce on demand.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const NIGHTLY = 150_000; // P1,500.00 a night, in thebe
const STAY_TOTAL = 150_000; // one night — the owner's "P500 of P1,500" example

let userId: string;
let propertyId: string;
let buildingId: string;
let ratePlanId: string;
let guestId: string;

/** Every reservation this suite creates, for teardown. */
const reservationIds: string[] = [];
const roomIds: string[] = [];

function buildService(): ReservationsService {
  const pricing = new PricingService(new PricingRepository(db));
  const quotes = new QuotesService(new QuotesRepository(db), pricing);
  const holds = new HoldsService(new HoldsRepository(db), quotes);
  const payments = new PaymentsService(new PaymentsRepository(db), new HoldsRepository(db), quotes);
  const invoices = new InvoicesService(new InvoicesRepository(db), quotes, new FilesRepository(db));
  return new ReservationsService(
    new ReservationsRepository(db),
    new RoomsRepository(db),
    pricing,
    quotes,
    holds,
    payments,
    invoices,
  );
}

const dayFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return new Date(d.toISOString().slice(0, 10));
};

/**
 * A booking on its own unit, so no two fixtures can collide on
 * reservations_no_overlap (invariant 4).
 */
async function makeBooking(label: string, folioTotal: number | null): Promise<string> {
  const roomId = (
    await db.insertInto('rooms')
      .values({
        name: `Folio ${label}`, code: `FO-${label}-${uniq}`.slice(0, 20), type: 'DELUXE',
        capacity: 4, building_id: buildingId, created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  roomIds.push(roomId);

  const id = (
    await db.insertInto('reservations')
      .values({
        contact_id: guestId, room_id: roomId,
        check_in_date: dayFromNow(30), check_out_date: dayFromNow(31), // 1 night
        status: 'PENDING', source: 'WEBSITE',
        folio_total_amount: folioTotal,
        created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  reservationIds.push(id);
  return id;
}

async function addInvoice(
  reservationId: string,
  fields: {
    kind: 'DEPOSIT' | 'BALANCE' | 'REFUND';
    status: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED' | 'VOID';
    total: number;
    deleted?: boolean;
  }
): Promise<string> {
  const row = await db.insertInto('invoices')
    .values({
      number: `INV-TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      reservation_id: reservationId,
      kind: fields.kind,
      // Zero-rated (migration 063): the advertised rate IS the price paid.
      subtotal_amount: fields.total, tax_rate_bps: 0, tax_amount: 0,
      total_amount: fields.total,
      status: fields.status,
      issued_by: userId, created_by: userId, updated_by: userId,
      ...(fields.deleted ? { deleted_at: new Date(), deleted_by: userId } : {}),
    })
    .returning('id').executeTakeFirstOrThrow();
  return row.id;
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (
    await db.insertInto('users')
      .values({ role_id: role.id, name: 'Folio Test', email: `folio-${uniq}@test.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  propertyId = (
    await db.insertInto('properties').values({ name: `FO_PROP_${uniq}` }).returning('id').executeTakeFirstOrThrow()
  ).id;
  buildingId = (
    await db.insertInto('buildings').values({ property_id: propertyId, name: `FO_BLDG_${uniq}` })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  ratePlanId = (
    await db.insertInto('rate_plans')
      .values({
        unit_type: 'DELUXE', name: `FO Rate ${uniq}`,
        nightly_rate: NIGHTLY, weekly_rate: NIGHTLY * 6, monthly_rate: NIGHTLY * 24,
        max_guests: 4, deposit_pct: 50, tax_rate_bps: 0,
        created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  guestId = (
    await db.insertInto('contacts')
      .values({ name: 'Kabo Seretse', email: `kabo-${uniq}@test.local`, created_by: userId, updated_by: userId })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  if (reservationIds.length > 0) {
    await db.deleteFrom('invoices').where('reservation_id', 'in', reservationIds).execute();
    await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
  }
  await db.deleteFrom('quotes').where('rate_plan_id', '=', ratePlanId).execute();
  await db.deleteFrom('rate_plans').where('id', '=', ratePlanId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  if (roomIds.length > 0) await db.deleteFrom('rooms').where('id', 'in', roomIds).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('booking folio', () => {
  it('reads UNPAID with the full total outstanding when nothing has been invoiced', async () => {
    const id = await makeBooking('unpaid', STAY_TOTAL);
    const folio = await buildService().getFolio(id, propertyId);

    expect(folio.total_amount).toBe(STAY_TOTAL);
    expect(folio.paid_amount).toBe(0);
    expect(folio.outstanding_amount).toBe(STAY_TOTAL);
    expect(folio.payment_state).toBe('UNPAID');
    expect(folio.total_source).toBe('FOLIO');
  });

  it('reads PART_PAID — the owner’s "P500 of P1,500" case', async () => {
    const id = await makeBooking('part', STAY_TOTAL);
    await addInvoice(id, { kind: 'DEPOSIT', status: 'PAID', total: 50_000 }); // P500
    await addInvoice(id, { kind: 'BALANCE', status: 'ISSUED', total: 100_000 }); // still owed

    const folio = await buildService().getFolio(id, propertyId);

    expect(folio.paid_amount).toBe(50_000);
    expect(folio.outstanding_amount).toBe(100_000);
    expect(folio.payment_state).toBe('PART_PAID');
    // The unpaid balance invoice must NOT count as money received — raising a document
    // is not the same as being paid, and conflating the two is how a receivables
    // ledger quietly reports itself as settled.
    expect(folio.invoices).toHaveLength(2);
  });

  it('reads PAID with nothing outstanding once the balance is settled', async () => {
    const id = await makeBooking('paid', STAY_TOTAL);
    await addInvoice(id, { kind: 'DEPOSIT', status: 'PAID', total: 50_000 });
    await addInvoice(id, { kind: 'BALANCE', status: 'PAID', total: 100_000 });

    const folio = await buildService().getFolio(id, propertyId);

    expect(folio.paid_amount).toBe(STAY_TOTAL);
    expect(folio.outstanding_amount).toBe(0);
    expect(folio.payment_state).toBe('PAID');
  });

  // ── The regression guard this suite exists for ───────────────────────────────
  it('nets a PARTIAL refund correctly — the original stays counted as received', async () => {
    const id = await makeBooking('refund', STAY_TOTAL);
    // The exact shape refundInvoice() leaves behind: original flipped to REFUNDED,
    // plus a separate positive REFUND row that is itself status PAID.
    await addInvoice(id, { kind: 'BALANCE', status: 'REFUNDED', total: 100_000 });
    await addInvoice(id, { kind: 'REFUND', status: 'PAID', total: 30_000 });

    const folio = await buildService().getFolio(id, propertyId);

    // P1,000 in, P300 back out = P700 held. Summing status='PAID' alone would give
    // MINUS P300 here, and the guest would appear to owe more than the whole stay.
    expect(folio.paid_amount).toBe(70_000);
    expect(folio.outstanding_amount).toBe(STAY_TOTAL - 70_000);
    expect(folio.payment_state).toBe('PART_PAID');
  });

  it('returns to UNPAID when everything received is refunded', async () => {
    const id = await makeBooking('fullref', STAY_TOTAL);
    await addInvoice(id, { kind: 'BALANCE', status: 'REFUNDED', total: STAY_TOTAL });
    await addInvoice(id, { kind: 'REFUND', status: 'PAID', total: STAY_TOTAL });

    const folio = await buildService().getFolio(id, propertyId);

    expect(folio.paid_amount).toBe(0);
    expect(folio.payment_state).toBe('UNPAID');
    expect(folio.outstanding_amount).toBe(STAY_TOTAL);
  });

  it('ignores soft-deleted and VOID invoices (invariant 5)', async () => {
    const id = await makeBooking('deleted', STAY_TOTAL);
    await addInvoice(id, { kind: 'DEPOSIT', status: 'PAID', total: 50_000, deleted: true });
    await addInvoice(id, { kind: 'BALANCE', status: 'VOID', total: 100_000 });

    const folio = await buildService().getFolio(id, propertyId);

    expect(folio.paid_amount).toBe(0);
    expect(folio.payment_state).toBe('UNPAID');
  });

  it('clamps an overpayment at zero outstanding rather than reporting a negative debt', async () => {
    const id = await makeBooking('over', STAY_TOTAL);
    await addInvoice(id, { kind: 'BALANCE', status: 'PAID', total: STAY_TOTAL + 25_000 });

    const folio = await buildService().getFolio(id, propertyId);

    expect(folio.paid_amount).toBe(STAY_TOTAL + 25_000);
    expect(folio.outstanding_amount).toBe(0);
    expect(folio.payment_state).toBe('PAID');
  });

  it('falls back to live pricing, and SAYS so, when no total was ever frozen', async () => {
    const id = await makeBooking('priced', null);
    const folio = await buildService().getFolio(id, propertyId);

    // One night on the DELUXE plan.
    expect(folio.total_amount).toBe(NIGHTLY);
    // The flag is the point: this figure came from TODAY's rate plan, so it will move
    // if rates move. The UI has to be able to tell the guest which one they are seeing.
    expect(folio.total_source).toBe('PRICED');
  });

  it('does not leak a booking from another property', async () => {
    const id = await makeBooking('scope', STAY_TOTAL);
    await expect(buildService().getFolio(id, '00000000-0000-0000-0000-000000000000'))
      .rejects.toThrow(/not found/i);
  });
});
