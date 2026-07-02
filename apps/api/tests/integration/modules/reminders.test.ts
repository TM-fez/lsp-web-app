/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the reminder sweep's unassigned-maintenance generator end-to-end against
 * real SQL: the age/status/assignment filters and the per-day dedup key. All
 * fixtures are self-created (CI's lsp_test is seeded minimally — see the
 * notifications suite) and assertions are scoped to those fixtures' entity ids,
 * because runReminders() scans the whole DB and other rows may raise counts too.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { runReminders } from '../../../src/modules/notifications/reminders.js';

let userId: string;
let propertyId: string;
let buildingId: string;
let roomId: string;
let woStale: string;    // OPEN, unassigned, 2 days old  -> reminded
let woFresh: string;    // OPEN, unassigned, just opened -> too fresh
let woAssigned: string; // OPEN, assigned, 2 days old    -> has an owner

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const user = await db
    .insertInto('users')
    .values({ role_id: role.id, name: 'Reminder Test', email: `reminder-${uniq}@test.local`, password_hash: 'x' })
    .returning('id')
    .executeTakeFirstOrThrow();
  userId = user.id;

  const prop = await db
    .insertInto('properties')
    .values({ name: `REMINDER_TEST_PROP_${uniq}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  propertyId = prop.id;

  // Membership makes the fixture user a recipient of the property fan-out.
  await db.insertInto('user_properties').values({ user_id: userId, property_id: propertyId }).execute();

  const building = await db
    .insertInto('buildings')
    .values({ property_id: propertyId, name: `REMINDER_TEST_BLDG_${uniq}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  buildingId = building.id;

  const room = await db
    .insertInto('rooms')
    .values({
      name: 'Reminder Test Room',
      code: `RTR-${uniq}`,
      building_id: buildingId,
      created_by: userId,
      updated_by: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  roomId = room.id;

  const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
  const orders = await db
    .insertInto('maintenance_work_orders')
    .values([
      { room_id: roomId, title: 'Stale unassigned', reported_by: userId, opened_at: twoDaysAgo },
      { room_id: roomId, title: 'Fresh unassigned', reported_by: userId },
      { room_id: roomId, title: 'Stale but assigned', reported_by: userId, assigned_to: userId, opened_at: twoDaysAgo },
    ])
    .returning(['id', 'title'])
    .execute();
  woStale = orders.find((o) => o.title === 'Stale unassigned')!.id;
  woFresh = orders.find((o) => o.title === 'Fresh unassigned')!.id;
  woAssigned = orders.find((o) => o.title === 'Stale but assigned')!.id;
});

afterAll(async () => {
  await db.deleteFrom('notifications').where('entity_id', 'in', [woStale, woFresh, woAssigned]).execute();
  await db.deleteFrom('maintenance_work_orders').where('id', 'in', [woStale, woFresh, woAssigned]).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('user_properties').where('user_id', '=', userId).execute();
  await db.deleteFrom('notifications').where('user_id', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
});

function myUnassignedReminders() {
  return db
    .selectFrom('notifications')
    .selectAll()
    .where('user_id', '=', userId)
    .where('type', '=', 'reminder.maintenance_unassigned')
    .execute();
}

describe('runReminders — unassigned maintenance (live DB)', () => {
  it('reminds only for the old unassigned order, and re-runs are no-ops', async () => {
    const first = await runReminders(db);
    expect(first.maintenanceUnassigned).toBeGreaterThanOrEqual(1);

    const rows = await myUnassignedReminders();
    const byEntity = rows.map((r) => r.entity_id);
    expect(byEntity).toContain(woStale);
    expect(byEntity).not.toContain(woFresh);    // too young to nag about
    expect(byEntity).not.toContain(woAssigned); // somebody owns it

    const mine = rows.filter((r) => r.entity_id === woStale);
    expect(mine).toHaveLength(1);
    expect(mine[0].link).toBe(`/maintenance/${woStale}`);
    expect(mine[0].title).toContain('unassigned');

    // Same-day re-run: the dated dedup key drops every duplicate.
    await runReminders(db);
    expect(await myUnassignedReminders().then((r) => r.filter((x) => x.entity_id === woStale))).toHaveLength(1);
  });
});
