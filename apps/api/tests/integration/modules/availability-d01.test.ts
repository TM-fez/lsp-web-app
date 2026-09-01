/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Defect D01 — "looked free, got 409".
 *
 * Two definitions of "blocked" were live at once. The availability engine counted only
 * CONFIRMED and BLOCKED nights, while ReservationsRepository.checkAvailability and the
 * reservations_no_overlap constraint both blocked on PENDING as well. A unit held by an
 * unpaid booking therefore read as FREE in search and then rejected the booking with a
 * 409. Public /stay bookings sit PENDING for up to WEBSITE_PENDING_TTL_HOURS, so it bit
 * hardest on direct bookings — the ones with the best margin.
 *
 * Owner decision (2026-09-01): an unpaid booking DOES hold the room.
 *
 * What this file actually guards is not "PENDING blocks" but the INVARIANT underneath:
 * whatever search says is free must be bookable, and whatever it says is taken must not
 * be. Asserted for both answers on the same unit, so reversing the policy fails here
 * loudly rather than silently reopening the divergence somewhere else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { AvailabilityService } from '../../../src/modules/availability/availability.service.js';
import { AvailabilityRepository } from '../../../src/modules/availability/availability.repository.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let userId: string;
let propertyId: string;
let buildingId: string;
let roomId: string;
let guestId: string;
let pendingId: string;

const CHECK_IN = new Date('2027-04-10');
const CHECK_OUT = new Date('2027-04-13');

const availability = () => new AvailabilityService(new AvailabilityRepository(db));
const reservations = () => new ReservationsRepository(db);

/** Does availability search offer this unit for the range? */
async function searchSaysFree(): Promise<boolean> {
  const res = await availability().getAvailableRooms(
    { check_in: CHECK_IN, check_out: CHECK_OUT, page: 1, limit: 100, guests: 1 } as never,
    propertyId,
  );
  return res.data.some((r) => r.id === roomId);
}

/** Would creating a booking actually be allowed? */
async function createSaysFree(): Promise<boolean> {
  return reservations().checkAvailability(roomId, CHECK_IN, CHECK_OUT);
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users')
    .values({ role_id: role.id, name: 'D01 Test', email: `d01-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;

  propertyId = (await db.insertInto('properties').values({ name: `D01_PROP_${uniq}` })
    .returning('id').executeTakeFirstOrThrow()).id;
  buildingId = (await db.insertInto('buildings').values({ property_id: propertyId, name: `D01_BLDG_${uniq}` })
    .returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({
    name: 'D01 Unit', code: `D01-${uniq}`, type: 'CUSTOM', capacity: 4,
    building_id: buildingId, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;

  guestId = (await db.insertInto('contacts')
    .values({ name: 'D01 Guest', created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('reservations').where('room_id', '=', roomId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('D01 — search and booking agree on what is free (live DB)', () => {
  it('offers an empty unit, and lets it be booked', async () => {
    expect(await searchSaysFree()).toBe(true);
    expect(await createSaysFree()).toBe(true);
  });

  it('stops offering a unit held by an UNPAID booking', async () => {
    pendingId = (await db.insertInto('reservations').values({
      contact_id: guestId, room_id: roomId,
      check_in_date: CHECK_IN, check_out_date: CHECK_OUT,
      status: 'PENDING', source: 'WEBSITE',
      created_by: userId, updated_by: userId,
    }).returning('id').executeTakeFirstOrThrow()).id;

    // The bug: this used to be true while createSaysFree() was false.
    expect(await searchSaysFree()).toBe(false);
    expect(await createSaysFree()).toBe(false);
  });

  // The invariant, stated as one assertion: the two answers are never allowed to differ.
  it('never lets the two answers disagree', async () => {
    expect(await searchSaysFree()).toBe(await createSaysFree());
  });

  it('releases the unit again once the unpaid booking is cancelled', async () => {
    await db.updateTable('reservations')
      .set({ status: 'CANCELLED', updated_by: userId })
      .where('id', '=', pendingId).execute();

    expect(await searchSaysFree()).toBe(true);
    expect(await createSaysFree()).toBe(true);
  });
});
