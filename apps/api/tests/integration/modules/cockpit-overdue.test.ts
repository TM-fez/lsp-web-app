/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * The stranding this file guards against, reported from the live app on 2026-09-01:
 * a CONFIRMED booking for 30 Aug → 3 Sept was invisible on the cockpit on 1 Sept.
 * Arrivals asked for `check_in_date = today`, so a guest whose arrival date had
 * passed was no longer an arrival; nobody had checked them in, so they were not
 * in-house either. The rail's Check in button is the ONLY one in the app, so the
 * booking could not be actioned at all and the board read 0% full with a guest due
 * in the unit.
 *
 * Departures had the identical bug mirrored: `check_out_date = today`, and since
 * In-house rows carry no action, an overstaying guest could never be checked out —
 * the unit stayed OCCUPIED, never reached the cleaning queue and could not be re-let.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { CockpitRepository } from '../../../src/modules/cockpit/cockpit.repository.js';
import { todayInPropertyTZ } from '../../../src/core/time.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let userId: string;
let propertyId: string;
let buildingId: string;
let lateRoomId: string;
let todayRoomId: string;
let overstayRoomId: string;
let guestId: string;
let lateArrivalId: string;
let todayArrivalId: string;
let overstayId: string;
let overstayOccupancyId: string;

/** A calendar date N days from the property's today, as 'YYYY-MM-DD'. */
function propertyDay(offset: number): string {
  const d = new Date(`${todayInPropertyTZ()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function makeRoom(code: string): Promise<string> {
  const r = await db.insertInto('rooms')
    .values({
      name: `Overdue ${code}`, code, type: 'CUSTOM', capacity: 4,
      building_id: buildingId, created_by: userId, updated_by: userId,
    })
    .returning('id').executeTakeFirstOrThrow();
  return r.id;
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users')
    .values({ role_id: role.id, name: 'Overdue Test', email: `od-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;

  propertyId = (await db.insertInto('properties').values({ name: `OD_PROP_${uniq}` })
    .returning('id').executeTakeFirstOrThrow()).id;
  buildingId = (await db.insertInto('buildings').values({ property_id: propertyId, name: `OD_BLDG_${uniq}` })
    .returning('id').executeTakeFirstOrThrow()).id;

  lateRoomId = await makeRoom(`OD-L-${uniq}`);
  todayRoomId = await makeRoom(`OD-T-${uniq}`);
  overstayRoomId = await makeRoom(`OD-O-${uniq}`);

  guestId = (await db.insertInto('contacts')
    .values({ name: 'Overdue Guest', created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow()).id;

  // Charity's shape: arrived two days ago, staying two more, never checked in.
  lateArrivalId = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: lateRoomId,
    check_in_date: new Date(propertyDay(-2)), check_out_date: new Date(propertyDay(2)),
    status: 'CONFIRMED', source: 'WALK_IN', created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;

  // The ordinary case, which must keep working.
  todayArrivalId = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: todayRoomId,
    check_in_date: new Date(propertyDay(0)), check_out_date: new Date(propertyDay(3)),
    status: 'CONFIRMED', source: 'WALK_IN', created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;

  // Checked in, and should have left yesterday.
  overstayId = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: overstayRoomId,
    check_in_date: new Date(propertyDay(-4)), check_out_date: new Date(propertyDay(-1)),
    status: 'CHECKED_IN', source: 'WALK_IN', created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;

  overstayOccupancyId = (await db.insertInto('occupancy').values({
    reservation_id: overstayId, room_id: overstayRoomId, guest_count: 1,
    status: 'CHECKED_IN', created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('occupancy').where('id', '=', overstayOccupancyId).execute();
  await db.deleteFrom('reservations')
    .where('id', 'in', [lateArrivalId, todayArrivalId, overstayId]).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', 'in', [lateRoomId, todayRoomId, overstayRoomId]).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Cockpit rail — overdue arrivals and departures (live DB)', () => {
  it('lists a guest whose arrival date has passed, alongside today’s', async () => {
    const arrivals = await new CockpitRepository(db).arrivals(propertyId);
    const ids = arrivals.map((a) => a.reservation_id);

    expect(ids).toContain(lateArrivalId);   // the bug: this used to be missing
    expect(ids).toContain(todayArrivalId);  // and this must not regress
    // Longest wait first — whoever has been standing there since Saturday.
    expect(ids.indexOf(lateArrivalId)).toBeLessThan(ids.indexOf(todayArrivalId));
  });

  it('does not dress a finished no-show up as an arrival', async () => {
    // Whole stay in the past, never checked in: a no-show, not someone to check in.
    const noShow = await db.insertInto('reservations').values({
      contact_id: guestId, room_id: lateRoomId,
      check_in_date: new Date(propertyDay(-20)), check_out_date: new Date(propertyDay(-18)),
      status: 'CONFIRMED', source: 'WALK_IN', created_by: userId, updated_by: userId,
    }).returning('id').executeTakeFirstOrThrow();

    try {
      const arrivals = await new CockpitRepository(db).arrivals(propertyId);
      expect(arrivals.map((a) => a.reservation_id)).not.toContain(noShow.id);
    } finally {
      await db.deleteFrom('reservations').where('id', '=', noShow.id).execute();
    }
  });

  it('keeps an overstaying guest in departures so they can still be checked out', async () => {
    const departures = await new CockpitRepository(db).departures(propertyId);
    const row = departures.find((d) => d.reservation_id === overstayId);

    expect(row).toBeDefined();
    // The Check out button needs the occupancy id — without it the row renders inert.
    expect(row!.occupancy_id).toBe(overstayOccupancyId);
  });
});
