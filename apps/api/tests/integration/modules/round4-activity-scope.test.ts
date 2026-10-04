/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4) The shared activity feed showed every "global" row — a rate-plan change, a staff
 * account, a company-level cost, another property's enquiry — to a user limited to one
 * property. Rows that belong to no property are now visible only to people who can see every
 * property, and to whoever did them. Leads follow their own property.
 *
 * Also proves the chunked read returns the same newest-first rows when the matches are
 * spread thinly through a long audit log (the performance rewrite must not lose rows).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { ActivityRepository } from '../../../src/modules/activity/activity.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let me: string, other: string;
let propCbd: string, propVillage: string, roomCbd: string, roomVillage: string;
let leadCbd: string, leadVillage: string, resCbd: string, resVillage: string, contactId: string;
const rowIds: string[] = [];
const GLOBAL_OTHERS = '00000000-0000-4000-8000-0000000000a1';
const GLOBAL_MINE = '00000000-0000-4000-8000-0000000000a2';
const repo = () => new ActivityRepository(db);

async function audit(entity: string, entityId: string, userId: string) {
  const r = await db.insertInto('audit_logs').values({
    request_id: null, user_id: userId, action: 'UPDATE', entity, entity_id: entityId, diff: null, ip_address: null,
  }).returning('id').executeTakeFirstOrThrow();
  rowIds.push(r.id);
}
const feed = async (viewer: { userId: string; allProperties: boolean }, property = propCbd) =>
  (await repo().recent(1000, property, viewer)).map((r) => r.entity_id);

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const mk = async (t: string) =>
    (await db.insertInto('users').values({ role_id: role.id, name: `ACT ${t}`, email: `act-${t}-${uniq}@t.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()).id;
  me = await mk('me');
  other = await mk('other');
  const prop = async (t: string) => {
    const p = (await db.insertInto('properties').values({ name: `ACT_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const b = (await db.insertInto('buildings').values({ property_id: p, name: `ACTB_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const r = (await db.insertInto('rooms').values({ name: `ACT ${t}`, code: `ACT-${t}-${uniq}`, building_id: b, created_by: me, updated_by: me })
      .returning('id').executeTakeFirstOrThrow()).id;
    return { p, r };
  };
  ({ p: propCbd, r: roomCbd } = await prop('CBD'));
  ({ p: propVillage, r: roomVillage } = await prop('VIL'));
  contactId = (await db.insertInto('contacts').values({ type: 'individual', name: `ACT guest ${uniq}`, created_by: me, updated_by: me } as never)
    .returning('id').executeTakeFirstOrThrow()).id;
  const reservation = async (room_id: string) =>
    (await db.insertInto('reservations').values({
      contact_id: contactId, room_id, check_in_date: new Date('2033-10-01'), check_out_date: new Date('2033-10-03'),
      status: 'PENDING', created_by: me, updated_by: me,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  resCbd = await reservation(roomCbd);
  resVillage = await reservation(roomVillage);
  const lead = async (property_id: string) =>
    (await db.insertInto('leads').values({ title: `ACT lead ${uniq}`, status: 'NEW', property_id, created_by: other, updated_by: other } as never)
      .returning('id').executeTakeFirstOrThrow()).id;
  leadCbd = await lead(propCbd);
  leadVillage = await lead(propVillage);

  await audit('reservations', resCbd, other);
  await audit('reservations', resVillage, other);
  await audit('leads', leadCbd, other);
  await audit('leads', leadVillage, other);
  await audit('rate_plans', GLOBAL_OTHERS, other); // belongs to no property, done by someone else
  await audit('rate_plans', GLOBAL_MINE, me);       // belongs to no property, done by me
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('id', 'in', rowIds).execute();
  await db.deleteFrom('leads').where('id', 'in', [leadCbd, leadVillage]).execute();
  await db.deleteFrom('reservations').where('id', 'in', [resCbd, resVillage]).execute();
  await db.deleteFrom('contacts').where('id', '=', contactId).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomCbd, roomVillage]).execute();
  await db.deleteFrom('buildings').where('property_id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('users').where('id', 'in', [me, other]).execute();
});

describe('activity feed for a user limited to one property', () => {
  it('shows their property’s rows and their own actions only', async () => {
    const ids = await feed({ userId: me, allProperties: false });
    expect(ids).toContain(resCbd);
    expect(ids).toContain(leadCbd);
    expect(ids).toContain(GLOBAL_MINE);
  });

  it('hides other properties’ rows and other people’s house-wide rows', async () => {
    const ids = await feed({ userId: me, allProperties: false });
    expect(ids).not.toContain(resVillage);
    expect(ids).not.toContain(leadVillage);
    expect(ids).not.toContain(GLOBAL_OTHERS);
  });
});

describe('activity feed for someone who can see every property', () => {
  it('still shows house-wide rows, but only the working property’s own rows', async () => {
    const ids = await feed({ userId: me, allProperties: true });
    expect(ids).toEqual(expect.arrayContaining([resCbd, leadCbd, GLOBAL_OTHERS, GLOBAL_MINE]));
    expect(ids).not.toContain(resVillage);
    expect(ids).not.toContain(leadVillage);
  });
});

describe('the chunked read', () => {
  it('finds matches that are buried under many other properties’ rows, newest first', async () => {
    // 450 newer Village rows (more than the first 200-row chunk) sit above one older CBD row.
    const old = await db.insertInto('audit_logs').values({
      request_id: null, user_id: other, action: 'UPDATE', entity: 'reservations', entity_id: resCbd, diff: null, ip_address: null,
      created_at: sql`now() + interval '1 hour'`,
    } as never).returning('id').executeTakeFirstOrThrow();
    rowIds.push(old.id);
    await db.insertInto('audit_logs').values((
      Array.from({ length: 450 }, (_, i) => ({
        request_id: null, user_id: other, action: 'UPDATE', entity: 'reservations', entity_id: resVillage, diff: null, ip_address: null,
        created_at: sql`now() + interval '1 hour' + ${i + 1} * interval '1 second'`,
      }))) as never).execute();
    try {
      const rows = await repo().recent(5, propCbd, { userId: me, allProperties: false });
      expect(rows.some((r) => r.id === old.id)).toBe(true);
      const times = rows.map((r) => r.created_at.getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    } finally {
      await db.deleteFrom('audit_logs').where('entity_id', '=', resVillage).execute();
    }
  });
});
