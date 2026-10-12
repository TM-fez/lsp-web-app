/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit H-1 follow-up) At boot the server looks for bookings saved before the stay-length cap
 * and tells every admin through the bell — once per booking, however often it restarts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { reportOverlongStays } from '../../../src/core/checks/overlongStays.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminId: string, propId: string, bldId: string, roomId: string, guestId: string, longId: string, normalId: string;

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  adminId = (await db.insertInto('users').values({ role_id: role, name: 'OL admin', email: `ol-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `OL_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `OLB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'OL', code: `OL-${uniq}`.slice(0, 20), building_id: bldId, created_by: adminId, updated_by: adminId }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `OL guest ${uniq}`, created_by: adminId, updated_by: adminId } as never).returning('id').executeTakeFirstOrThrow()).id;
  const book = async (from: string, to: string) =>
    (await db.insertInto('reservations').values({
      contact_id: guestId, room_id: roomId, check_in_date: new Date(from), check_out_date: new Date(to),
      status: 'PENDING', source: 'WEBSITE', created_by: adminId, updated_by: adminId,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  // As one made before the H-1 fix could be: thousands of years long.
  longId = await book('2041-01-01', '9999-01-01');
  normalId = await book('2040-01-01', '2040-01-05');
});

afterAll(async () => {
  await db.deleteFrom('notifications').where('user_id', '=', adminId).execute();
  await db.deleteFrom('reservations').where('id', 'in', [longId, normalId]).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', adminId).execute();
});

const mine = () =>
  db.selectFrom('notifications').select(['entity_id', 'type', 'link']).where('user_id', '=', adminId).execute();

describe('startup check for over-long stays', () => {
  it('finds the over-long booking (not the normal one) and tells the admin', async () => {
    const ids = await reportOverlongStays(db);
    expect(ids).toContain(longId);
    expect(ids).not.toContain(normalId);
    const n = await mine();
    expect(n).toEqual([{ entity_id: longId, type: 'check.overlong_stay', link: `/reservations/${longId}` }]);
  });

  it('a restart does not alert twice', async () => {
    await reportOverlongStays(db);
    expect(await mine()).toHaveLength(1);
  });
});
