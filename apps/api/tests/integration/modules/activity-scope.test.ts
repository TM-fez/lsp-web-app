/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Defect D03 — the shared activity feed was not property-scoped, so a Village user read
 * CBD's activity. `audit_logs` carries no property column (unlike the money paths, scoped
 * in H5), so the property is resolved at read time by walking each entity back down its
 * own chain to a building.
 *
 * Two things have to hold at once, and they pull in opposite directions:
 *   · a row that BELONGS to another property must not appear;
 *   · a row that belongs to NO property — a guest, a rate plan, a staff account — is
 *     house-wide and must still appear, or the feed silently loses most of its content.
 * Both are asserted here, because a filter that is too aggressive fails as quietly as one
 * that is too loose.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ActivityRepository } from '../../../src/modules/activity/activity.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let userId: string;
let propA: string, propB: string;
let bldA: string, bldB: string;
let roomA: string, roomB: string;
let contactId: string;
let resA: string, resB: string;
// Its own id: an unmapped entity is global by design, so reusing a real booking's id
// here would make that booking look like it had leaked across properties.
const UNMAPPED_ID = '00000000-0000-4000-8000-0000000000d3';

const repo = () => new ActivityRepository(db);

async function makeProperty(tag: string) {
  const p = await db.insertInto('properties').values({ name: `SCOPE_${tag}_${uniq}` })
    .returning('id').executeTakeFirstOrThrow();
  const b = await db.insertInto('buildings').values({ property_id: p.id, name: `B_${tag}_${uniq}` })
    .returning('id').executeTakeFirstOrThrow();
  const r = await db.insertInto('rooms').values({
    name: `Unit ${tag}`, code: `SC-${tag}-${uniq}`, type: 'CUSTOM', capacity: 2,
    building_id: b.id, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow();
  return { propertyId: p.id, buildingId: b.id, roomId: r.id };
}

async function audit(entity: string, entityId: string) {
  await db.insertInto('audit_logs').values({
    request_id: null, user_id: userId, action: 'UPDATE',
    entity, entity_id: entityId, diff: null, ip_address: null,
  }).execute();
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users')
    .values({ role_id: role.id, name: 'Scope Test', email: `scope-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;

  const a = await makeProperty('A'); propA = a.propertyId; bldA = a.buildingId; roomA = a.roomId;
  const b = await makeProperty('B'); propB = b.propertyId; bldB = b.buildingId; roomB = b.roomId;

  contactId = (await db.insertInto('contacts')
    .values({ name: `Scope Guest ${uniq}`, created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow()).id;

  const mk = async (roomId: string) => (await db.insertInto('reservations').values({
    contact_id: contactId, room_id: roomId,
    check_in_date: new Date('2027-06-01'), check_out_date: new Date('2027-06-03'),
    status: 'PENDING', source: 'WALK_IN', created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  resA = await mk(roomA);
  resB = await mk(roomB);

  // One row per shape we care about.
  await audit('reservations', resA);
  await audit('reservations', resB);
  await audit('rooms', roomA);
  await audit('contacts', contactId);            // global — no property anywhere
  await audit('channel_collision', roomB);       // entity_id is a ROOM, not a reservation
  await audit('something_unmapped', UNMAPPED_ID); // unknown entity — must not vanish
  await audit('reservations', 'not-a-uuid');     // TEXT column: must not break the query
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('reservations').where('id', 'in', [resA, resB]).execute();
  await db.deleteFrom('contacts').where('id', '=', contactId).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomA, roomB]).execute();
  await db.deleteFrom('buildings').where('id', 'in', [bldA, bldB]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propA, propB]).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Activity feed — property scoping (live DB)', () => {
  // Asserted on entity_id, not entity type. This suite shares a database with every other
  // integration file, and their teardowns HARD-delete the entities their audit rows point
  // at — which resolve to NULL and read as global. Matching on type alone would fail on
  // their leftovers rather than on anything this test controls.
  it('does not show another property’s activity', async () => {
    const a = await repo().recent(500, propA);
    const b = await repo().recent(500, propB);
    const ids = (rows: typeof a) => rows.map((r) => r.entity_id);

    expect(ids(a)).toContain(roomA);   // A's own unit
    expect(ids(a)).not.toContain(roomB);
    expect(ids(a)).not.toContain(resB); // B's booking

    expect(ids(b)).toContain(roomB);   // B's collision, keyed on B's room
    expect(ids(b)).not.toContain(roomA);
    expect(ids(b)).not.toContain(resA);
  });

  // The opposite failure: over-filtering. A guest, a rate plan or a staff account belongs
  // to the whole house and must stay in every property's feed.
  it('keeps house-wide rows visible in every property', async () => {
    for (const p of [propA, propB]) {
      const rows = await repo().recent(500, p);
      expect(rows.map((r) => r.entity_id)).toContain(contactId);
    }
  });

  // A feed that silently drops rows is the exact failure this audit was about.
  it('keeps an entity nobody has mapped rather than hiding it', async () => {
    const rows = await repo().recent(500, propA);
    expect(rows.some((r) => r.entity === 'something_unmapped')).toBe(true);
  });

  // entity_id is TEXT. One unparseable value must not blank the whole feed.
  it('survives a non-uuid entity_id', async () => {
    const rows = await repo().recent(500, propA);
    expect(rows.map((r) => r.entity_id)).toContain('not-a-uuid');
  });

  it('shows everything when no property is given', async () => {
    const ids = (await repo().recent(500)).map((r) => r.entity_id);
    expect(ids).toContain(roomA);
    expect(ids).toContain(roomB);
    expect(ids).toContain(contactId);
  });
});
