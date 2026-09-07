/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the desk-payment loop end-to-end against real SQL. A booking taken on the
 * public site arrives PENDING with no quote, hold or payment intent behind it, and
 * only settlePaid() may confirm a reservation — so this exercises the whole chain
 * the service assembles (quote → hold → intent → settlePaid) plus the receipt that
 * comes out of the far end.
 *
 * The receipt is the part worth testing hardest: before it existed, a settled booking
 * produced NO invoice at all, which is why the Finance screens read empty. And an
 * invoice nobody can attribute is barely better than no invoice, so the list join is
 * asserted here too — against a corporate shape, where the bill goes to a company
 * and the guest is somebody else.
 *
 * Unit type CUSTOM, not STANDARD: only one rate plan per unit type may be active at
 * a time, so a shared type would collide with any other suite that wants one.
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

let userId: string;
let propertyId: string;
let buildingId: string;
let roomId: string;
let guestId: string;
let billerId: string;
let ratePlanId: string;
let reservationId: string;
let partPaidRoomId: string;
let partPaidReservationId: string;

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

// Dates well clear of today so the past-check-in guard never fires.
const dayFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return new Date(d.toISOString().slice(0, 10));
};

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (
    await db.insertInto('users')
      .values({ role_id: role.id, name: 'MarkPaid Test', email: `mp-${uniq}@test.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  propertyId = (
    await db.insertInto('properties').values({ name: `MP_PROP_${uniq}` }).returning('id').executeTakeFirstOrThrow()
  ).id;
  buildingId = (
    await db.insertInto('buildings').values({ property_id: propertyId, name: `MP_BLDG_${uniq}` })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  roomId = (
    await db.insertInto('rooms')
      .values({
        name: 'MarkPaid Unit', code: `MP-${uniq}`, type: 'CUSTOM', capacity: 4,
        building_id: buildingId, created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  // Zero-rated (migration 063): the advertised rate IS the price paid.
  ratePlanId = (
    await db.insertInto('rate_plans')
      .values({
        unit_type: 'CUSTOM', name: `MP Rate ${uniq}`,
        nightly_rate: NIGHTLY, weekly_rate: NIGHTLY * 6, monthly_rate: NIGHTLY * 24,
        max_guests: 4, deposit_pct: 50, tax_rate_bps: 0,
        created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  const contacts = await db.insertInto('contacts').values([
    { name: 'Neo Kgosi', email: `neo-${uniq}@test.local`, created_by: userId, updated_by: userId },
    { name: 'Debswana Accounts', company: 'Debswana', email: `ap-${uniq}@test.local`, created_by: userId, updated_by: userId },
  ]).returning(['id', 'name']).execute();
  guestId = contacts.find((c) => c.name === 'Neo Kgosi')!.id;
  billerId = contacts.find((c) => c.name === 'Debswana Accounts')!.id;

  // A second unit + booking, for the part-payment case (its own unit so the two
  // stays cannot collide on the no-overlap constraint).
  partPaidRoomId = (
    await db.insertInto('rooms')
      .values({
        name: 'MarkPaid Unit 2', code: `MP2-${uniq}`, type: 'CUSTOM', capacity: 4,
        building_id: buildingId, created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  // The shape this feature exists for: a WEBSITE booking, PENDING, no hold behind it.
  reservationId = (
    await db.insertInto('reservations')
      .values({
        contact_id: guestId, room_id: roomId,
        check_in_date: dayFromNow(30), check_out_date: dayFromNow(32),  // 2 nights
        status: 'PENDING', source: 'WEBSITE',
        billing_contact_id: billerId,
        created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  partPaidReservationId = (
    await db.insertInto('reservations')
      .values({
        contact_id: guestId, room_id: partPaidRoomId,
        check_in_date: dayFromNow(40), check_out_date: dayFromNow(42),  // 2 nights
        status: 'PENDING', source: 'WEBSITE',
        created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('invoices').where('reservation_id', '=', reservationId).execute();
  // Scoped to this test's own hold — an unqualified delete here would wipe every
  // other suite's payment rows out from under it.
  const allReservations = [reservationId, partPaidReservationId];
  await db.deleteFrom('invoices').where('reservation_id', 'in', allReservations).execute();
  const holdIds = (
    await db.selectFrom('holds').select('id').where('reservation_id', 'in', allReservations).execute()
  ).map((h) => h.id);
  if (holdIds.length > 0) {
    const intentIds = (
      await db.selectFrom('payment_intents').select('id').where('hold_id', 'in', holdIds).execute()
    ).map((i) => i.id);
    if (intentIds.length > 0) {
      await db.deleteFrom('payment_attempts').where('payment_intent_id', 'in', intentIds).execute();
      await db.deleteFrom('payment_intents').where('id', 'in', intentIds).execute();
    }
  }
  await db.deleteFrom('holds').where('reservation_id', 'in', allReservations).execute();
  await db.deleteFrom('reservations').where('id', 'in', allReservations).execute();
  await db.deleteFrom('quotes').where('rate_plan_id', '=', ratePlanId).execute();
  await db.deleteFrom('rate_plans').where('id', '=', ratePlanId).execute();
  await db.deleteFrom('contacts').where('id', 'in', [guestId, billerId]).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomId, partPaidRoomId]).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Recording a desk payment (live DB)', () => {
  it('confirms the booking and raises a paid receipt for it', async () => {
    const service = buildService();
    const meta = { userId, ip: null, requestId: null } as never;

    const confirmed = await service.markPaid(reservationId, { method: 'CASH' } as never, meta);

    // settlePaid() is the only thing allowed to do this, and it did.
    expect(confirmed.status).toBe('CONFIRMED');

    const invoice = await db.selectFrom('invoices')
      .selectAll().where('reservation_id', '=', reservationId).executeTakeFirstOrThrow();

    expect(invoice.status).toBe('PAID');          // money already in hand, not owing
    expect(invoice.kind).toBe('BALANCE');         // paid in full
    expect(invoice.total_amount).toBe(NIGHTLY * 2);
    expect(invoice.tax_amount).toBe(0);           // zero-rated
    expect(invoice.subtotal_amount).toBe(NIGHTLY * 2);
  });

  it('shows the invoice against the company billed and the guest who stayed', async () => {
    const repo = new InvoicesRepository(db);
    const page = await repo.findPaginated({}, { page: 1, limit: 100 });
    const row = page.data.find((i) => i.reservation_id === reservationId);

    expect(row).toBeDefined();
    // The A4 bill-to: the company pays, so the company is who Accounts chases.
    expect(row!.bill_to_name).toBe('Debswana Accounts');
    expect(row!.guest_name).toBe('Neo Kgosi');
    expect(row!.unit_code).toBe(`MP-${uniq}`);
    expect(row!.check_in_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // Reception takes what the guest has on them. The rest must not vanish.
  it('invoices the unpaid remainder of a part payment, and Finance counts it', async () => {
    const service = buildService();
    const meta = { userId, ip: null, requestId: null } as never;
    const HALF = NIGHTLY;                    // one night's worth of a two-night stay
    const DUE = NIGHTLY * 2;

    await service.markPaid(partPaidReservationId, { method: 'CASH', amount: HALF } as never, meta);

    const invoices = await db.selectFrom('invoices')
      .selectAll().where('reservation_id', '=', partPaidReservationId)
      .orderBy('total_amount', 'asc').execute();

    expect(invoices).toHaveLength(2);

    const receipt = invoices.find((i) => i.status === 'PAID')!;
    const owing = invoices.find((i) => i.status === 'ISSUED')!;

    expect(receipt.kind).toBe('DEPOSIT');
    expect(receipt.total_amount).toBe(HALF);
    expect(owing.kind).toBe('BALANCE');
    expect(owing.total_amount).toBe(DUE - HALF);

    // The point of the whole thing: the debt is visible to Accounts. Finance treats an
    // ISSUED DEPOSIT/BALANCE invoice as an open receivable.
    const open = await db.selectFrom('invoices')
      .select('id')
      .where('reservation_id', '=', partPaidReservationId)
      .where('status', 'in', ['ISSUED', 'PARTIALLY_PAID'])
      .where('kind', 'in', ['DEPOSIT', 'BALANCE'])
      .where('deleted_at', 'is', null)
      .execute();
    expect(open.map((o) => o.id)).toEqual([owing.id]);
  });

  // The Payments screen reads this list. Unjoined it is a row of UUIDs and an amount,
  // with no way to tell whose payment failed.
  it('names the guest and unit on the payments list', async () => {
    const page = await new PaymentsRepository(db).findPaginated({}, { page: 1, limit: 100 });
    const mine = page.data.filter((p) => p.guest_name === 'Neo Kgosi');

    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]!.unit_code).toMatch(/^MP/);
    expect(mine[0]!.reservation_id).toBeTruthy();
  });

  // This used to assert that a CONFIRMED booking could not be paid again. That rule was
  // wrong once CONFIRMED stopped meaning "paid" (owner decision 2026-09-07): it blocked
  // the second half of a part payment, and blocked the pay-after-the-stay guest
  // entirely. What actually protects the guest is the FOLIO — you cannot take money
  // that is not owed — so that is what is asserted now.
  it('refuses a second payment once the booking owes nothing', async () => {
    const service = buildService();
    const folio = await service.getFolio(reservationId);
    expect(folio.outstanding_amount).toBe(0);

    await expect(
      service.markPaid(reservationId, { method: 'CASH' } as never, { userId } as never),
    ).rejects.toThrow('already paid in full');
  });

  it('takes the remainder — and only the remainder — on a part-paid booking', async () => {
    const service = buildService();
    const before = await service.getFolio(partPaidReservationId);
    expect(before.payment_state).toBe('PART_PAID');
    expect(before.outstanding_amount).toBeGreaterThan(0);

    await service.markPaid(partPaidReservationId, { method: 'CASH' } as never, { userId } as never);

    const after = await service.getFolio(partPaidReservationId);
    expect(after.outstanding_amount).toBe(0);
    expect(after.payment_state).toBe('PAID');
    // Capping against the whole stay rather than the outstanding balance would have
    // charged the guest the full amount a second time.
    expect(after.paid_amount).toBe(before.total_amount);
  });
});
