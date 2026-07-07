/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the reminder sweep's lease-renewal generator: a long stay checking out in
 * exactly the lead window raises one nudge to the property; a short stay or one
 * departing on a different day does not; re-runs the same day are no-ops. Dates use
 * the DB's current_date (Africa/Gaborone) — the reference the generator uses.
 * Fixtures are self-created; assertions are scoped to their reservation ids.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { remindLeaseRenewals } from '../../../src/modules/notifications/reminders.js';

let userId: string;
let propertyId: string;
let buildingId: string;
let contactId: string;
const roomIds: string[] = [];
let resRenew: string;   // 30-night stay, checks out in 7 days -> reminded
let resShort: string;   // 5-night stay, checks out in 7 days  -> too short
let resWrongDay: string;// 30-night stay, checks out in 3 days -> not the lead day
const resIds: string[] = [];

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const user = await db.insertInto('users')
    .values({ role_id: role.id, name: 'Lease Test', email: `lease-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow();
  userId = user.id;
  const prop = await db.insertInto('properties').values({ name: `LEASE_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  propertyId = prop.id;
  await db.insertInto('user_properties').values({ user_id: userId, property_id: propertyId }).execute();
  const building = await db.insertInto('buildings').values({ property_id: propertyId, name: `LEASE_B_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  buildingId = building.id;

  // Distinct rooms so the overlapping stays don't trip the no-overlap constraint.
  const rooms = await db.insertInto('rooms')
    .values([0, 1, 2].map((i) => ({ name: `Lease ${i}`, code: `LSE-${i}-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId })))
    .returning('id').execute();
  roomIds.push(...rooms.map((r) => r.id));

  const contact = await db.insertInto('contacts').values({ type: 'individual', name: 'Long Stayer', created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow();
  contactId = contact.id;

  const mkRes = async (roomIdx: number, checkOutInDays: number, nights: number) => {
    const r = await db.insertInto('reservations')
      .values({
        contact_id: contactId, room_id: roomIds[roomIdx]!,
        check_in_date: sql<Date>`current_date + ${sql.lit(checkOutInDays - nights)}`,
        check_out_date: sql<Date>`current_date + ${sql.lit(checkOutInDays)}`,
        status: 'CONFIRMED', created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow();
    resIds.push(r.id);
    return r.id;
  };
  resRenew = await mkRes(0, 7, 30);
  resShort = await mkRes(1, 7, 5);
  resWrongDay = await mkRes(2, 3, 30);
});

afterAll(async () => {
  await db.deleteFrom('notifications').where('entity_id', 'in', resIds).execute();
  await db.deleteFrom('notifications').where('user_id', '=', userId).execute();
  await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  await db.deleteFrom('contacts').where('id', '=', contactId).execute();
  await db.deleteFrom('rooms').where('id', 'in', roomIds).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('user_properties').where('user_id', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
});

const myRenewalReminders = () =>
  db.selectFrom('notifications').selectAll().where('user_id', '=', userId).where('type', '=', 'reminder.lease_renewal').execute();

describe('runReminders — lease renewals (live DB)', () => {
  it('nudges only for the long stay departing in the lead window, and re-runs are no-ops', async () => {
    const first = await remindLeaseRenewals(db);
    expect(first).toBeGreaterThanOrEqual(1);

    const rows = await myRenewalReminders();
    const byEntity = rows.map((r) => r.entity_id);
    expect(byEntity).toContain(resRenew);
    expect(byEntity).not.toContain(resShort);     // too short to be a lease
    expect(byEntity).not.toContain(resWrongDay);  // not the lead day

    const mine = rows.filter((r) => r.entity_id === resRenew);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.link).toBe(`/reservations/${resRenew}`);
    expect(mine[0]!.title).toContain('Long-stay');

    await remindLeaseRenewals(db); // same-day re-run
    expect(await myRenewalReminders().then((r) => r.filter((x) => x.entity_id === resRenew))).toHaveLength(1);
  });
});
