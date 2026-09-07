/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Pay-later, end to end: a guest is booked, confirmed and checked in WITHOUT paying,
 * the unit reads occupied, and the money still shows as owed.
 *
 * Owner decision 2026-09-07 (amending invariant 3): CONFIRMED means the stay is on, not
 * that the money arrived. Before this, settlePaid() was the only sanctioned way to reach
 * CONFIRMED and check-in refused anything else — so a guest who pays after the stay
 * could not be checked in at all. Staff worked around it by not booking, which is how a
 * walk-in ends up with no record anywhere and the room they are sleeping in reads free.
 *
 * The centrepiece is `the walk-in who pays later`: it is the owner's own scenario, and
 * it asserts the two halves that have to be true TOGETHER — the room is occupied AND the
 * money is still outstanding. Either alone is a system that lies.
 *
 * Unit type SUITE, claimed by this suite: rate_plans_active_unit_type_unique allows only
 * one ACTIVE plan per unit type, so sharing a type collides with whichever suite runs
 * alongside. CUSTOM is mark-paid's, DELUXE is folio's, STANDARD is everyone else's.
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
import { CheckinsService } from '../../../src/modules/checkins/checkins.service.js';
import { CheckinsRepository } from '../../../src/modules/checkins/checkins.repository.js';
import { CockpitRepository } from '../../../src/modules/cockpit/cockpit.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const NIGHTLY = 150_000; // P1,500.00 a night, in thebe

let userId: string;
let propertyId: string;
let buildingId: string;
let ratePlanId: string;
let guestId: string;

const reservationIds: string[] = [];
const roomIds: string[] = [];

const meta = () => ({ userId, ip: null, requestId: null });

function reservations(): ReservationsService {
  const pricing = new PricingService(new PricingRepository(db));
  const quotes = new QuotesService(new QuotesRepository(db), pricing);
  const holds = new HoldsService(new HoldsRepository(db), quotes);
  const payments = new PaymentsService(new PaymentsRepository(db), new HoldsRepository(db), quotes);
  const invoices = new InvoicesService(new InvoicesRepository(db), quotes, new FilesRepository(db));
  return new ReservationsService(
    new ReservationsRepository(db), new RoomsRepository(db), pricing, quotes, holds, payments, invoices,
  );
}
const checkins = () => new CheckinsService(new CheckinsRepository(db));
const cockpit = () => new CockpitRepository(db);

const day = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return new Date(d.toISOString().slice(0, 10));
};

async function makeBooking(
  label: string,
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED',
  checkIn: Date,
  checkOut: Date
): Promise<string> {
  const roomId = (
    await db.insertInto('rooms')
      .values({
        name: `PayLater ${label}`, code: `PL-${label}-${uniq}`.slice(0, 20), type: 'SUITE',
        capacity: 2, status: 'AVAILABLE', housekeeping_status: 'READY',
        building_id: buildingId, created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  roomIds.push(roomId);

  const id = (
    await db.insertInto('reservations')
      .values({
        contact_id: guestId, room_id: roomId,
        check_in_date: checkIn, check_out_date: checkOut,
        status, source: 'WALK_IN', created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  reservationIds.push(id);
  return id;
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (
    await db.insertInto('users')
      .values({ role_id: role.id, name: 'PayLater Test', email: `pl-${uniq}@test.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  propertyId = (
    await db.insertInto('properties').values({ name: `PL_PROP_${uniq}` }).returning('id').executeTakeFirstOrThrow()
  ).id;
  buildingId = (
    await db.insertInto('buildings').values({ property_id: propertyId, name: `PL_BLDG_${uniq}` })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  ratePlanId = (
    await db.insertInto('rate_plans')
      .values({
        unit_type: 'SUITE', name: `PL Rate ${uniq}`,
        nightly_rate: NIGHTLY, weekly_rate: NIGHTLY * 6, monthly_rate: NIGHTLY * 24,
        max_guests: 4, deposit_pct: 50, tax_rate_bps: 0,
        created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  guestId = (
    await db.insertInto('contacts')
      .values({ name: 'Mpho Baruti', email: `mpho-${uniq}@test.local`, created_by: userId, updated_by: userId })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  if (reservationIds.length > 0) {
    await db.deleteFrom('occupancy').where('reservation_id', 'in', reservationIds).execute();
    await db.deleteFrom('invoices').where('reservation_id', 'in', reservationIds).execute();
    await db.deleteFrom('holds').where('reservation_id', 'in', reservationIds).execute();
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

describe('confirming without payment', () => {
  it('confirms a PENDING booking, records who and why, and freezes the price', async () => {
    const id = await makeBooking('conf', 'PENDING', day(10), day(12)); // 2 nights

    const confirmed = await reservations().confirmWithoutPayment(
      id, { note: 'Corporate account — settles monthly' }, meta(), propertyId
    );

    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmed_without_payment).toBe(true);
    expect(confirmed.confirmed_by).toBe(userId);
    expect(confirmed.confirmed_at).toBeTruthy();
    expect(confirmed.confirmation_note).toBe('Corporate account — settles monthly');

    // Frozen at confirmation, so a later rate change cannot restate what this guest
    // owes (migration 067).
    expect(confirmed.folio_total_amount).toBe(NIGHTLY * 2);

    // Invariant 6 — and this is the control that replaces a permission gate, so it
    // matters that the diff actually carries the flag.
    const audit = await db.selectFrom('audit_logs').select(['action', 'diff'])
      .where('entity', '=', 'reservations').where('entity_id', '=', id)
      .orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(audit.action).toBe('UPDATE');
    expect((audit.diff as Record<string, unknown>).confirmed_without_payment).toBe(true);
  });

  it('leaves the money owed — confirming is not paying', async () => {
    const id = await makeBooking('owed', 'PENDING', day(14), day(15));
    await reservations().confirmWithoutPayment(id, {}, meta(), propertyId);

    const folio = await reservations().getFolio(id, propertyId);
    expect(folio.payment_state).toBe('UNPAID');
    expect(folio.outstanding_amount).toBe(NIGHTLY);
    expect(folio.total_source).toBe('FOLIO');
  });

  it('refuses a booking that is not PENDING', async () => {
    const id = await makeBooking('already', 'CONFIRMED', day(16), day(17));
    await expect(reservations().confirmWithoutPayment(id, {}, meta(), propertyId))
      .rejects.toThrow(/already confirmed/i);
  });

  it('refuses a cancelled booking', async () => {
    const id = await makeBooking('cancelled', 'CANCELLED', day(18), day(19));
    await expect(reservations().confirmWithoutPayment(id, {}, meta(), propertyId))
      .rejects.toThrow(/cancelled booking cannot be confirmed/i);
  });
});

describe('the walk-in who pays later', () => {
  it('checks in unpaid, occupies the unit, and still shows the money owed', async () => {
    // Arrives today, staying two nights, has not paid a thebe.
    const id = await makeBooking('walkin', 'PENDING', day(0), day(2));
    const roomId = roomIds[roomIds.length - 1]!;

    // 1. The cockpit must SEE them. Filtering arrivals to CONFIRMED used to hide an
    //    unpaid guest completely: not an arrival, not in-house, and the rail's Check in
    //    button is the only one in the app — so they were unreachable.
    const arrivals = await cockpit().arrivals(propertyId);
    expect(arrivals.map((a) => a.reservation_id)).toContain(id);

    // 2. They check in without paying.
    const occupancy = await checkins().checkIn({ reservation_id: id, guest_count: 2 } as never, meta());
    expect(occupancy.status).toBe('CHECKED_IN');

    // 3. The unit reads occupied — the owner's explicit requirement.
    const room = await db.selectFrom('rooms').select('status')
      .where('id', '=', roomId).executeTakeFirstOrThrow();
    expect(room.status).toBe('OCCUPIED');

    const reservation = await db.selectFrom('reservations').select('status')
      .where('id', '=', id).executeTakeFirstOrThrow();
    expect(reservation.status).toBe('CHECKED_IN');

    // 4. And the money is still owed. This is the half that makes the whole thing safe:
    //    the stay proceeds, and nothing anywhere pretends it was paid for.
    const folio = await reservations().getFolio(id, propertyId);
    expect(folio.payment_state).toBe('UNPAID');
    expect(folio.outstanding_amount).toBeGreaterThan(0);
  });

  it('still refuses to check in a cancelled booking', async () => {
    const id = await makeBooking('cxl', 'CANCELLED', day(0), day(2));
    await expect(checkins().checkIn({ reservation_id: id, guest_count: 1 } as never, meta()))
      .rejects.toThrow(/cancelled booking cannot be checked in/i);
  });
});
