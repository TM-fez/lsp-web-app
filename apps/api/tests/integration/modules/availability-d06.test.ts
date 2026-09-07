/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Defect D06 — "a guest in the room tonight made it unbookable for ever".
 *
 * The occupancy leg of every availability query read
 *   WHERE deleted_at IS NULL AND status = 'CHECKED_IN'
 * with NO date predicate. `occupancy` carries no dates of its own — it hangs off a
 * reservation — so an active occupancy blocked its unit across EVERY range, however
 * far in the future. Ask "what is free next month" with a full house tonight and the
 * answer was "nothing". That is precisely the question the booking calendar and the
 * walk-in search exist to answer, so it had to be fixed before either was built.
 *
 * The fix is NOT to delete the occupancy leg. CHECKED_IN now sits in the date-bounded
 * reservation whitelist and covers the guest's SCHEDULED nights, but the leg still
 * earns its place for one case: an OVERSTAY. A guest whose check-out date has passed
 * and who has not checked out is still physically in the room, and their reservation's
 * dates no longer say so. So the leg is BOUNDED to today — the only day on which "they
 * are still in there" is a fact rather than a guess.
 *
 * What this file guards is the pair, not either half: today stays blocked, the future
 * opens up. Deleting the leg would pass the future assertions and fail the overstay one;
 * reverting the bound would pass the overstay one and fail the future ones.
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
let inHouseRoomId: string;
let overstayRoomId: string;
let guestId: string;

const reservationIds: string[] = [];

const availability = () => new AvailabilityService(new AvailabilityRepository(db));

/** A date offset from today in the property's timezone, as a Date at UTC midnight. */
const day = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return new Date(d.toISOString().slice(0, 10));
};

/** Does availability search offer this unit for the range? */
async function searchOffers(roomId: string, checkIn: Date, checkOut: Date): Promise<boolean> {
  const res = await availability().getAvailableRooms(
    { check_in: checkIn, check_out: checkOut, page: 1, limit: 100, guests: 1 } as never,
    propertyId,
  );
  return res.data.some((r: { id: string }) => r.id === roomId);
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (
    await db.insertInto('users')
      .values({ role_id: role.id, name: 'D06 Test', email: `d06-${uniq}@test.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  propertyId = (
    await db.insertInto('properties').values({ name: `D06_PROP_${uniq}` }).returning('id').executeTakeFirstOrThrow()
  ).id;
  buildingId = (
    await db.insertInto('buildings').values({ property_id: propertyId, name: `D06_BLDG_${uniq}` })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  guestId = (
    await db.insertInto('contacts')
      .values({ name: 'Lorato Modise', email: `lorato-${uniq}@test.local`, created_by: userId, updated_by: userId })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  // Unit 1 — a guest who checked in yesterday and leaves in two days. Normal in-house.
  inHouseRoomId = (
    await db.insertInto('rooms')
      .values({
        name: 'D06 In-house', code: `D6A-${uniq}`.slice(0, 20), type: 'STANDARD', capacity: 2,
        // OCCUPIED is what check-in sets on the room; the point of this suite is that the
        // room's own status is NOT what over-blocks the future — the occupancy join was.
        status: 'OCCUPIED',
        building_id: buildingId, created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  const inHouseRes = (
    await db.insertInto('reservations')
      .values({
        contact_id: guestId, room_id: inHouseRoomId,
        check_in_date: day(-1), check_out_date: day(2),
        status: 'CHECKED_IN', source: 'DIRECT', created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  reservationIds.push(inHouseRes);
  await db.insertInto('occupancy').values({
    reservation_id: inHouseRes, room_id: inHouseRoomId, status: 'CHECKED_IN',
    created_by: userId, updated_by: userId,
  }).execute();

  // Unit 2 — the overstay: due out yesterday, never checked out, still in the room.
  overstayRoomId = (
    await db.insertInto('rooms')
      .values({
        name: 'D06 Overstay', code: `D6B-${uniq}`.slice(0, 20), type: 'STANDARD', capacity: 2,
        status: 'OCCUPIED',
        building_id: buildingId, created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;

  const overstayRes = (
    await db.insertInto('reservations')
      .values({
        contact_id: guestId, room_id: overstayRoomId,
        check_in_date: day(-4), check_out_date: day(-1), // due out YESTERDAY
        status: 'CHECKED_IN', source: 'DIRECT', created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow()
  ).id;
  reservationIds.push(overstayRes);
  await db.insertInto('occupancy').values({
    reservation_id: overstayRes, room_id: overstayRoomId, status: 'CHECKED_IN',
    created_by: userId, updated_by: userId,
  }).execute();
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  if (reservationIds.length > 0) {
    await db.deleteFrom('occupancy').where('reservation_id', 'in', reservationIds).execute();
    await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
  }
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', 'in', [inHouseRoomId, overstayRoomId]).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('D06 — an active occupancy must not block the future', () => {
  it('offers an in-house unit for a range next month', async () => {
    // The whole point. Before the fix this was false, and a walk-in asking about next
    // month was told the house was full.
    expect(await searchOffers(inHouseRoomId, day(30), day(33))).toBe(true);
  });

  it('offers an in-house unit for the night after its guest leaves', async () => {
    // Guest leaves on day(2); half-open [) means day(2) is sellable (invariant 4).
    expect(await searchOffers(inHouseRoomId, day(2), day(4))).toBe(true);
  });

  it('still refuses the unit for tonight', async () => {
    expect(await searchOffers(inHouseRoomId, day(0), day(1))).toBe(false);
  });

  it('still refuses the unit for the guest’s remaining scheduled nights', async () => {
    // Covered by the reservation leg now that CHECKED_IN is in its whitelist — not by
    // the occupancy leg. If someone drops CHECKED_IN from that whitelist, this fails.
    expect(await searchOffers(inHouseRoomId, day(1), day(2))).toBe(false);
  });

  // ── The case that stops the leg being deleted outright ───────────────────────
  it('refuses a unit whose guest has OVERSTAYED, though the booking has ended', async () => {
    // The reservation says they left yesterday. The occupancy says otherwise, and the
    // occupancy is right — someone is asleep in there. Only the bounded occupancy leg
    // catches this; the reservation leg cannot, because its dates have passed.
    expect(await searchOffers(overstayRoomId, day(0), day(1))).toBe(false);
  });

  it('offers the overstayed unit next month rather than blocking it for ever', async () => {
    // Honest limit: we do not know when an overstaying guest will actually leave, so we
    // block today (a fact) and not the future (a guess). The cockpit's overdue rail is
    // where staff resolve the overstay itself.
    expect(await searchOffers(overstayRoomId, day(30), day(33))).toBe(true);
  });
});
