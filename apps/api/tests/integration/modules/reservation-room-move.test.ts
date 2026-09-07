/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Moving an IN-HOUSE guest to another unit used to corrupt the cockpit.
 *
 * `occupancy.room_id` is written once at check-in and was never touched again, while
 * `modifyReservation` happily changed `reservations.room_id`. The cockpit reads the two
 * through different joins — its in-house and departures cards go through OCCUPANCY, its
 * unit tiles go through the RESERVATION — so after a move the board showed the guest
 * still in the old unit AND showed the new unit as empty. Two screens, two answers,
 * neither of them true. Both units' `rooms.status` were stale too: the old one still
 * OCCUPIED, the new one still AVAILABLE.
 *
 * This is not a calendar bug. It is reachable today through the reservations drawer —
 * it just becomes far easier to hit once a booking can be dragged between units.
 *
 * The whole move rides the one transaction the reservation update already opened
 * (invariant 6), because a half-applied move is worse than none: a guest with no room,
 * or a room with two guests, either of which the cockpit would then present as fact.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let userId: string;
let propertyId: string;
let buildingId: string;
let fromRoomId: string;
let toRoomId: string;
let guestId: string;
let reservationId: string;
let occupancyId: string;
let pendingReservationId: string;
let pendingFromRoomId: string;
let pendingToRoomId: string;

const meta = () => ({ userId, ip: null, requestId: null });

const service = () =>
  new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db));

const day = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return new Date(d.toISOString().slice(0, 10));
};

async function makeRoom(label: string, status: 'AVAILABLE' | 'OCCUPIED'): Promise<string> {
  return (
    await db.insertInto('rooms')
      .values({
        name: `Move ${label}`, code: `MV-${label}-${uniq}`.slice(0, 20), type: 'STANDARD',
        capacity: 2, status, housekeeping_status: 'READY',
        building_id: buildingId, created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (
    await db.insertInto('users')
      .values({ role_id: role.id, name: 'Move Test', email: `move-${uniq}@test.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  propertyId = (
    await db.insertInto('properties').values({ name: `MV_PROP_${uniq}` }).returning('id').executeTakeFirstOrThrow()
  ).id;
  buildingId = (
    await db.insertInto('buildings').values({ property_id: propertyId, name: `MV_BLDG_${uniq}` })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  guestId = (
    await db.insertInto('contacts')
      .values({ name: 'Tebogo Phiri', email: `tebogo-${uniq}@test.local`, created_by: userId, updated_by: userId })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  fromRoomId = await makeRoom('A', 'OCCUPIED');
  toRoomId = await makeRoom('B', 'AVAILABLE');

  reservationId = (
    await db.insertInto('reservations')
      .values({
        contact_id: guestId, room_id: fromRoomId,
        check_in_date: day(-1), check_out_date: day(3),
        status: 'CHECKED_IN', source: 'DIRECT', created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  occupancyId = (
    await db.insertInto('occupancy')
      .values({
        reservation_id: reservationId, room_id: fromRoomId, status: 'CHECKED_IN',
        created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  // A booking that has NOT checked in — moving it must not invent occupancy or touch
  // room statuses, because nobody is in either unit.
  pendingFromRoomId = await makeRoom('C', 'AVAILABLE');
  pendingToRoomId = await makeRoom('D', 'AVAILABLE');
  pendingReservationId = (
    await db.insertInto('reservations')
      .values({
        contact_id: guestId, room_id: pendingFromRoomId,
        check_in_date: day(20), check_out_date: day(23),
        status: 'PENDING', source: 'DIRECT', created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  const allReservations = [reservationId, pendingReservationId];
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('occupancy').where('reservation_id', 'in', allReservations).execute();
  await db.deleteFrom('reservations').where('id', 'in', allReservations).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms')
    .where('id', 'in', [fromRoomId, toRoomId, pendingFromRoomId, pendingToRoomId]).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('moving an in-house guest between units', () => {
  it('carries the occupancy row, both room statuses and the audit trail with the booking', async () => {
    await service().modifyReservation(reservationId, { room_id: toRoomId }, meta(), propertyId);

    const reservation = await db.selectFrom('reservations').select('room_id')
      .where('id', '=', reservationId).executeTakeFirstOrThrow();
    expect(reservation.room_id).toBe(toRoomId);

    // The bug. Before the fix this still read fromRoomId, and the cockpit showed the
    // guest in a unit they had left.
    const occupancy = await db.selectFrom('occupancy').select(['room_id', 'status'])
      .where('id', '=', occupancyId).executeTakeFirstOrThrow();
    expect(occupancy.room_id).toBe(toRoomId);
    expect(occupancy.status).toBe('CHECKED_IN');

    const vacated = await db.selectFrom('rooms').select(['status', 'housekeeping_status'])
      .where('id', '=', fromRoomId).executeTakeFirstOrThrow();
    expect(vacated.status).toBe('AVAILABLE');
    // Someone has just moved out of it. Leaving it READY would let it be handed to the
    // next guest uncleaned.
    expect(vacated.housekeeping_status).toBe('DIRTY');

    const entered = await db.selectFrom('rooms').select('status')
      .where('id', '=', toRoomId).executeTakeFirstOrThrow();
    expect(entered.status).toBe('OCCUPIED');

    // Invariant 6: every mutation audits, and a move is four of them.
    const audits = await db.selectFrom('audit_logs').select(['entity', 'entity_id'])
      .where('user_id', '=', userId).execute();
    expect(audits.filter((a) => a.entity === 'occupancy' && a.entity_id === occupancyId)).toHaveLength(1);
    expect(audits.filter((a) => a.entity === 'rooms' && a.entity_id === fromRoomId)).toHaveLength(1);
    expect(audits.filter((a) => a.entity === 'rooms' && a.entity_id === toRoomId)).toHaveLength(1);
    expect(audits.filter((a) => a.entity === 'reservations' && a.entity_id === reservationId)).toHaveLength(1);
  });

  it('leaves rooms alone when the booking has not checked in', async () => {
    await service().modifyReservation(
      pendingReservationId, { room_id: pendingToRoomId }, meta(), propertyId
    );

    const moved = await db.selectFrom('reservations').select('room_id')
      .where('id', '=', pendingReservationId).executeTakeFirstOrThrow();
    expect(moved.room_id).toBe(pendingToRoomId);

    // Nobody is in either unit, so neither status may move — and in particular the
    // destination must NOT be marked OCCUPIED for a guest who has not arrived.
    for (const roomId of [pendingFromRoomId, pendingToRoomId]) {
      const room = await db.selectFrom('rooms').select(['status', 'housekeeping_status'])
        .where('id', '=', roomId).executeTakeFirstOrThrow();
      expect(room.status).toBe('AVAILABLE');
      expect(room.housekeeping_status).toBe('READY');
    }

    const occupancy = await db.selectFrom('occupancy').select('id')
      .where('reservation_id', '=', pendingReservationId).execute();
    expect(occupancy).toHaveLength(0);
  });
});
