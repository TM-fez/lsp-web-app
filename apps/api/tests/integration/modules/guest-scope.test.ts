/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Owner decision 2026-10-04) Staff limited to some properties see only those properties'
 * guests — in the guest list, a guest by id, the marketing segments and the activity
 * feed. Guests who have never booked, and guests the user created, stay visible (they
 * belong to no property yet); admins see everyone.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createContactsRouter } from '../../../src/modules/crm/contacts/contacts.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { MarketingRepository } from '../../../src/modules/marketing/marketing.repository.js';
import { ActivityRepository } from '../../../src/modules/activity/activity.repository.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ user: null as any }));
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: () => {
      if (!mockState.user) throw new Error('jwt malformed');
      return mockState.user;
    },
  },
}));

const app = express();
app.use(express.json());
app.use('/contacts', createContactsRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let staff: string, other: string;
let propA: string, propB: string, bldA: string, bldB: string, roomA: string, roomB: string;
const c: Record<string, string> = {};
const resIds: string[] = [];
const auditIds: string[] = [];

const asStaff = () => { mockState.user = { sub: staff, role: 'reception', permissions: ['crm.contacts.read'] }; };
const asAdmin = () => { mockState.user = { sub: other, role: 'admin', permissions: ['crm.contacts.read'] }; };
const list = async () =>
  ((await request(app).get(`/contacts?search=${uniq}&limit=100`).set('Authorization', 'Bearer t')).body.data as Array<{ id: string }>).map((r) => r.id);

beforeAll(async () => {
  const roleId = async (n: string) => (await db.selectFrom('roles').select('id').where('name', '=', n).executeTakeFirstOrThrow()).id;
  const user = async (role: string, tag: string) =>
    (await db.insertInto('users').values({ role_id: await roleId(role), name: `GS ${tag}`, email: `gs-${tag}-${uniq}@t.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()).id;
  staff = await user('reception', 'staff');
  other = await user('admin', 'other');

  const prop = async (t: string) => {
    const p = (await db.insertInto('properties').values({ name: `GS_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const b = (await db.insertInto('buildings').values({ property_id: p, name: `GSB_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const r = (await db.insertInto('rooms').values({ name: `GS ${t}`, code: `GS-${t}-${uniq}`, building_id: b, created_by: other, updated_by: other })
      .returning('id').executeTakeFirstOrThrow()).id;
    return { p, b, r };
  };
  ({ p: propA, b: bldA, r: roomA } = await prop('A'));
  ({ p: propB, b: bldB, r: roomB } = await prop('B'));
  await db.insertInto('user_properties').values({ user_id: staff, property_id: propA }).execute();

  const contact = async (tag: string, createdBy: string) => {
    c[tag] = (await db.insertInto('contacts').values({ name: `GS ${tag} ${uniq}`, created_by: createdBy, updated_by: createdBy })
      .returning('id').executeTakeFirstOrThrow()).id;
  };
  await contact('guestA', other);
  await contact('guestB', other);
  await contact('prospect', other);
  await contact('mine', staff);

  let day = 0;
  const book = async (contactId: string, roomId: string) => {
    day += 3;
    resIds.push((await db.insertInto('reservations').values({
      contact_id: contactId, room_id: roomId, check_in_date: new Date(Date.UTC(2035, 0, day)), check_out_date: new Date(Date.UTC(2035, 0, day + 2)),
      status: 'PENDING', created_by: other, updated_by: other,
    } as never).returning('id').executeTakeFirstOrThrow()).id);
  };
  await book(c.guestA!, roomA);
  await book(c.guestB!, roomB);
  await book(c.mine!, roomB);

  for (const tag of ['guestA', 'guestB', 'prospect']) {
    auditIds.push((await db.insertInto('audit_logs').values({
      user_id: other, action: 'UPDATE', entity: 'contacts', entity_id: c[tag]!, diff: {},
    } as never).returning('id').executeTakeFirstOrThrow()).id);
  }
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('id', 'in', auditIds).execute();
  await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  await db.deleteFrom('contacts').where('id', 'in', Object.values(c)).execute();
  await db.deleteFrom('user_properties').where('user_id', '=', staff).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomA, roomB]).execute();
  await db.deleteFrom('buildings').where('id', 'in', [bldA, bldB]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propA, propB]).execute();
  await db.deleteFrom('audit_logs').where('user_id', 'in', [staff, other]).execute();
  await db.deleteFrom('users').where('id', 'in', [staff, other]).execute();
});

describe('guests are per property for property-limited staff', () => {
  it('lists their property’s guests, never-booked guests and their own — not another property’s', async () => {
    asStaff();
    const ids = await list();
    expect(ids).toEqual(expect.arrayContaining([c.guestA, c.prospect, c.mine]));
    expect(ids).not.toContain(c.guestB);
  });

  it('a guest from another property is "not found" by id, and cannot be edited', async () => {
    asStaff();
    expect((await request(app).get(`/contacts/${c.guestB}`).set('Authorization', 'Bearer t')).status).toBe(404);
    mockState.user.permissions.push('crm.contacts.update');
    expect((await request(app).patch(`/contacts/${c.guestB}`).set('Authorization', 'Bearer t').send({ notes: 'x' })).status).toBe(404);
  });

  it('admins see every guest', async () => {
    asAdmin();
    expect(await list()).toEqual(expect.arrayContaining([c.guestA, c.guestB, c.prospect, c.mine]));
  });

  it('marketing segments only count the guests the viewer may see', async () => {
    const rows = await new MarketingRepository(db).customerStats({ propertyIds: [propA], userId: staff });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(c.guestA);
    expect(ids).not.toContain(c.guestB);
  });

  it('the activity feed shows a guest’s changes only in the property they booked at', async () => {
    const feedA = (await new ActivityRepository(db).recent(200, propA)).map((r) => r.entity_id);
    expect(feedA).toContain(c.guestA);
    expect(feedA).toContain(c.prospect); // never booked → house-wide
    expect(feedA).not.toContain(c.guestB);
  });
});
