/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4) Two summary endpoints ignored property scope:
 *   GET /dashboard/stats  — house-wide guest and staff counts for everyone (cached under one key);
 *   GET /users/directory  — every active staff member's name and role for everyone.
 * A user limited to one property now counts only the guests they may see and the staff who
 * share one of their properties, and the cache is kept per scope.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createUsersRouter } from '../../../src/modules/users/users.routes.js';
import { dashboardRouter } from '../../../src/modules/dashboard/dashboard.routes.js';
import { clearStatsCache } from '../../../src/modules/dashboard/dashboard.service.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';
import { sql } from 'kysely';
import { getAggregateStats } from '../../../src/modules/dashboard/dashboard.repository.js';

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
app.use('/users', createUsersRouter());
app.use('/dashboard', dashboardRouter);
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let cbdUser: string, cbdColleague: string, villageStaff: string, floating: string;
let propCbd: string, propVillage: string, roomVillage: string, roomCbd: string;
let villageGuest: string, cbdGuest: string;
const users: string[] = [];
const names: Record<string, string> = {};

const asCbd = () => { mockState.user = { sub: cbdUser, role: 'reception', permissions: ['dashboard:read'] }; };
const asAdmin = () => { mockState.user = { sub: cbdUser, role: 'admin', permissions: ['dashboard:read'] }; };
const get = (path: string) => request(app).get(path).set('Authorization', 'Bearer t');
const directoryNames = async () => ((await get('/users/directory')).body.data as Array<{ name: string }>).map((u) => u.name);

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'reception').executeTakeFirstOrThrow()).id;
  const mk = async (t: string) => {
    names[t] = `DIR ${t} ${uniq}`;
    const id = (await db.insertInto('users').values({ role_id: role, name: names[t], email: `dir-${t}-${uniq}@t.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()).id;
    users.push(id);
    return id;
  };
  cbdUser = await mk('me');
  cbdColleague = await mk('colleague');
  villageStaff = await mk('village');
  floating = await mk('floating');
  const prop = async (t: string) => {
    const p = (await db.insertInto('properties').values({ name: `DIR_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const b = (await db.insertInto('buildings').values({ property_id: p, name: `DIRB_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const r = (await db.insertInto('rooms').values({ name: `DIR ${t}`, code: `DIR-${t}-${uniq}`, building_id: b, created_by: cbdUser, updated_by: cbdUser })
      .returning('id').executeTakeFirstOrThrow()).id;
    return { p, r };
  };
  ({ p: propCbd, r: roomCbd } = await prop('CBD'));
  ({ p: propVillage, r: roomVillage } = await prop('VIL'));
  await db.insertInto('user_properties').values([
    { user_id: cbdUser, property_id: propCbd },
    { user_id: cbdColleague, property_id: propCbd },
    { user_id: villageStaff, property_id: propVillage },
  ]).execute();
  // Two guests, each booked in one property (created by a third party, so "created by me" does not apply).
  const guest = async (t: string, room: string) => {
    const c = (await db.insertInto('contacts').values({ type: 'individual', name: `DIR guest ${t} ${uniq}`, created_by: villageStaff, updated_by: villageStaff } as never)
      .returning('id').executeTakeFirstOrThrow()).id;
    await db.insertInto('reservations').values({
      contact_id: c, room_id: room, check_in_date: new Date('2033-11-01'), check_out_date: new Date('2033-11-03'),
      status: 'PENDING', created_by: villageStaff, updated_by: villageStaff,
    } as never).execute();
    return c;
  };
  villageGuest = await guest('village', roomVillage);
  cbdGuest = await guest('cbd', roomCbd);
});

afterAll(async () => {
  const guests = [villageGuest, cbdGuest];
  await db.deleteFrom('reservations').where('contact_id', 'in', guests).execute();
  await db.deleteFrom('contacts').where('id', 'in', guests).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomCbd, roomVillage]).execute();
  await db.deleteFrom('buildings').where('property_id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', users).execute();
  await db.deleteFrom('properties').where('id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('users').where('id', 'in', users).execute();
  clearStatsCache();
});

describe('GET /users/directory', () => {
  it('a CBD-only user sees themselves and CBD colleagues — not Village or property-less staff', async () => {
    asCbd();
    const list = await directoryNames();
    expect(list).toContain(names.me);
    expect(list).toContain(names.colleague);
    expect(list).not.toContain(names.village);
    expect(list).not.toContain(names.floating);
  });

  it('an all-property user (admin) still sees everyone', async () => {
    asAdmin();
    const list = await directoryNames();
    expect(list).toEqual(expect.arrayContaining(Object.values(names)));
  });
});

describe('GET /dashboard/stats', () => {
  it('counts only the guests and staff a CBD-only user may see, and does not leak through the cache', async () => {
    clearStatsCache();
    asAdmin();
    const house = (await get('/dashboard/stats')).body;
    asCbd();
    const mine = (await get('/dashboard/stats')).body;

    expect(mine.totalUsers).toBe(2);                          // me + my CBD colleague
    expect(house.totalUsers).toBeGreaterThanOrEqual(4);
    // The admin's cached house-wide numbers are not served to the limited user, nor vice versa.
    asAdmin();
    expect((await get('/dashboard/stats')).body.totalUsers).toBe(house.totalUsers);
  });

  // The guest count is a house-wide number, and other test files add and remove guests all
  // the time — comparing two HTTP answers taken a moment apart flaked when a parallel file
  // created unbooked (= visible to everyone) guests in between. Both counts are taken here
  // from ONE repeatable-read snapshot, so the only difference left is the scope rule: the
  // Village guest is in the house count and not in CBD's.
  it('counts fewer guests for a CBD-only user than for the house, in the same snapshot', async () => {
    const [house, mine] = await db.connection().execute(async (conn) => {
      await sql`BEGIN ISOLATION LEVEL REPEATABLE READ`.execute(conn);
      try {
        const h = await getAggregateStats({ userId: cbdUser, ids: null, allProperties: true }, conn);
        const m = await getAggregateStats({ userId: cbdUser, ids: [propCbd], allProperties: false }, conn);
        return [h, m] as const;
      } finally {
        await sql`COMMIT`.execute(conn);
      }
    });
    expect(mine.totalContacts).toBeLessThan(house.totalContacts);
    expect(house.totalContacts - mine.totalContacts).toBeGreaterThanOrEqual(1); // at least the Village guest
  });
});
