/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, N-3) Payroll was house-wide: a CBD-only accounts user could read every
 * employee's pay and bank details, change a Village cleaner's salary, and post a
 * no-property company cost built from the whole payroll.
 *
 * The rule under test: staff are "in" a property when they have a membership there. Someone
 * who can see every property sees everyone; a limited user sees only staff in their own
 * properties, can edit only those, and posts costs only per own property (never a
 * company-level one).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createPayrollRouter } from '../../../src/modules/payroll/payroll.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
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
app.use('/payroll', createPayrollRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PERMS = ['payroll.read', 'payroll.manage'];
let clerk: string, cbdStaff: string, villageStaff: string, floatingStaff: string;
let propCbd: string, propVillage: string;
const users: string[] = [];
const MONTH_LIMITED = '2031-03';
const MONTH_ADMIN = '2031-04';

const asClerk = () => { mockState.user = { sub: clerk, role: 'accounts', permissions: PERMS }; };
const asAdmin = () => { mockState.user = { sub: clerk, role: 'admin', permissions: PERMS }; };
const call = (method: 'get' | 'put' | 'post', path: string, body?: object) =>
  request(app)[method](path).set('Authorization', 'Bearer t').send(body);

async function makeUser(label: string, roleName: string, property?: string, pay?: number): Promise<string> {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', roleName).executeTakeFirstOrThrow()).id;
  const id = (await db.insertInto('users').values({
    role_id: role, name: `PR4 ${label} ${uniq}`, email: `pr4-${label}-${uniq}@t.local`, password_hash: 'x',
  }).returning('id').executeTakeFirstOrThrow()).id;
  users.push(id);
  if (property) await db.insertInto('user_properties').values({ user_id: id, property_id: property }).execute();
  if (pay) {
    await db.insertInto('staff_compensation').values({
      user_id: id, gross_amount: pay, frequency: 'MONTHLY', active: true, created_by: id, updated_by: id,
    } as never).execute();
  }
  return id;
}

beforeAll(async () => {
  propCbd = (await db.insertInto('properties').values({ name: `PR4_CBD_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  propVillage = (await db.insertInto('properties').values({ name: `PR4_VIL_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  clerk = await makeUser('clerk', 'accounts', propCbd);
  cbdStaff = await makeUser('cbdstaff', 'housekeeping', propCbd, 1_000_00);
  villageStaff = await makeUser('villstaff', 'housekeeping', propVillage, 2_000_00);
  floatingStaff = await makeUser('floating', 'maintenance', undefined, 4_000_00);
});

afterAll(async () => {
  await db.deleteFrom('operating_expenses').where('created_by', '=', clerk).execute();
  await db.deleteFrom('audit_logs').where('user_id', 'in', users).execute();
  await db.deleteFrom('staff_compensation').where('user_id', 'in', users).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', users).execute();
  await db.deleteFrom('users').where('id', 'in', users).execute();
  await db.deleteFrom('properties').where('id', 'in', [propCbd, propVillage]).execute();
});

describe('payroll employee list', () => {
  it('a CBD-only user sees only staff who work in CBD', async () => {
    asClerk();
    const res = await call('get', '/payroll/employees');
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ user_id: string }>).map((e) => e.user_id);
    expect(ids).toContain(cbdStaff);
    expect(ids).not.toContain(villageStaff);
    expect(ids).not.toContain(floatingStaff);
  });

  it('an all-property user (admin) still sees everyone, including staff with no property', async () => {
    asAdmin();
    const ids = ((await call('get', '/payroll/employees')).body.data as Array<{ user_id: string }>).map((e) => e.user_id);
    expect(ids).toEqual(expect.arrayContaining([cbdStaff, villageStaff, floatingStaff]));
  });
});

describe('payroll summary', () => {
  it('counts only the caller’s own staff', async () => {
    asClerk();
    const res = await call('get', '/payroll/summary');
    expect(res.status).toBe(200);
    // Only cbdStaff has pay inside CBD: 1 person, P1,000.00.
    expect(res.body.headcount).toBe(1);
    expect(res.body.monthly_total).toBe(1_000_00);
  });
});

describe('editing pay', () => {
  it('another property’s staff member is "not found" and the salary is untouched', async () => {
    asClerk();
    const res = await call('put', `/payroll/employees/${villageStaff}`, { gross_amount: 1, frequency: 'MONTHLY' });
    expect(res.status).toBe(404);
    const row = await db.selectFrom('staff_compensation').select('gross_amount').where('user_id', '=', villageStaff).executeTakeFirstOrThrow();
    expect(row.gross_amount).toBe(2_000_00);
  });

  it('a staff member with no property is also out of reach for a limited user', async () => {
    asClerk();
    expect((await call('put', `/payroll/employees/${floatingStaff}`, { gross_amount: 1, frequency: 'MONTHLY' })).status).toBe(404);
  });

  it('their own property’s staff can still be edited', async () => {
    asClerk();
    const res = await call('put', `/payroll/employees/${cbdStaff}`, { gross_amount: 1_100_00, frequency: 'MONTHLY' });
    expect(res.status).toBe(200);
    await db.updateTable('staff_compensation').set({ gross_amount: 1_000_00 }).where('user_id', '=', cbdStaff).execute();
  });
});

describe('post to operating costs', () => {
  it('a limited user posts one cost for their own property only — never a company-level cost', async () => {
    asClerk();
    const res = await call('post', '/payroll/post-to-costs', { month: MONTH_LIMITED });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(1_000_00);

    const rows = await db.selectFrom('operating_expenses').select(['property_id', 'amount', 'category'])
      .where('created_by', '=', clerk).where('deleted_at', 'is', null).execute();
    expect(rows).toEqual([{ property_id: propCbd, amount: 1_000_00, category: 'PAYROLL' }]);
  });

  it('posting the same month again is refused, not doubled', async () => {
    asClerk();
    expect((await call('post', '/payroll/post-to-costs', { month: MONTH_LIMITED })).status).toBe(409);
  });

  it('an all-property post is refused while a property share for that month exists (no double count)', async () => {
    asAdmin();
    expect((await call('post', '/payroll/post-to-costs', { month: MONTH_LIMITED })).status).toBe(409);
  });

  it('an all-property user still posts the single company-level cost for everyone', async () => {
    asAdmin();
    const res = await call('post', '/payroll/post-to-costs', { month: MONTH_ADMIN });
    expect(res.status).toBe(201);
    const row = await db.selectFrom('operating_expenses').select(['property_id', 'notes'])
      .where('id', '=', res.body.operating_expense_id).executeTakeFirstOrThrow();
    expect(row).toEqual({ property_id: null, notes: `payroll:${MONTH_ADMIN}` });
    // Includes at least the three staff made above (1,000 + 2,000 + 4,000).
    expect(res.body.amount).toBeGreaterThanOrEqual(7_000_00);
  });

  it('a limited user is refused once the company-level cost exists for that month', async () => {
    asClerk();
    expect((await call('post', '/payroll/post-to-costs', { month: MONTH_ADMIN })).status).toBe(409);
  });
});
