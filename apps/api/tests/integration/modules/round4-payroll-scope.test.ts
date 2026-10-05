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
  await db.deleteFrom('operating_expenses').where('created_by', 'in', users).execute();
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

  // (R5, migration 086) Each person is costed once, at their home property, whoever posts.
  it('an all-property post after a property’s share posts only the rest — nobody twice', async () => {
    asAdmin();
    const res = await call('post', '/payroll/post-to-costs', { month: MONTH_LIMITED });
    expect(res.status).toBe(201);
    const rows = await db.selectFrom('operating_expenses').select(['property_id', 'amount', 'notes'])
      .where('notes', 'like', `payroll:${MONTH_LIMITED}%`).where('deleted_at', 'is', null).execute();
    expect(rows.filter((r) => r.property_id === propCbd)).toEqual([
      { property_id: propCbd, amount: 1_000_00, notes: `payroll:${MONTH_LIMITED}:${propCbd}` },
    ]);
    expect(rows.find((r) => r.property_id === propVillage)?.amount).toBe(2_000_00);
    // Staff with no property (the floating 4,000) are the company-level cost.
    expect(rows.find((r) => r.property_id === null)!.amount).toBeGreaterThanOrEqual(4_000_00);
    // And the month is now closed for everyone.
    expect((await call('post', '/payroll/post-to-costs', { month: MONTH_LIMITED })).status).toBe(409);
  });

  it('an all-property user posts one cost per home property plus a company-level cost', async () => {
    asAdmin();
    const res = await call('post', '/payroll/post-to-costs', { month: MONTH_ADMIN });
    expect(res.status).toBe(201);
    const rows = await db.selectFrom('operating_expenses').select(['property_id', 'amount', 'notes'])
      .where('id', 'in', res.body.operating_expense_ids).execute();
    expect(rows.find((r) => r.property_id === propCbd)).toEqual({ property_id: propCbd, amount: 1_000_00, notes: `payroll:${MONTH_ADMIN}:${propCbd}` });
    expect(rows.find((r) => r.property_id === propVillage)?.amount).toBe(2_000_00);
    expect(rows.find((r) => r.property_id === null)?.notes).toBe(`payroll:${MONTH_ADMIN}`);
    // The parts add up to the whole (at least the three staff made above).
    expect(res.body.amount).toBe(rows.reduce((t, r) => t + r.amount, 0));
    expect(res.body.amount).toBeGreaterThanOrEqual(7_000_00);
  });

  it('a limited user is refused once the company-level cost exists for that month', async () => {
    asClerk();
    expect((await call('post', '/payroll/post-to-costs', { month: MONTH_ADMIN })).status).toBe(409);
  });
});

describe('R5 — a person who works in two properties is costed once', () => {
  const MONTH_A = '2031-05';
  const MONTH_B = '2031-06';
  let villageClerk: string, dual: string;
  const asVillageClerk = () => { mockState.user = { sub: villageClerk, role: 'accounts', permissions: PERMS }; };

  it('two accountants posting their own property never both charge the shared person', async () => {
    villageClerk = await makeUser('vclerk', 'accounts', propVillage);
    dual = await makeUser('dual', 'housekeeping', propCbd, 500_00);
    await db.insertInto('user_properties').values({ user_id: dual, property_id: propVillage }).execute();

    asClerk();
    const cbd = await call('post', '/payroll/post-to-costs', { month: MONTH_A });
    asVillageClerk();
    const vil = await call('post', '/payroll/post-to-costs', { month: MONTH_A });
    expect(cbd.status).toBe(201);
    expect(vil.status).toBe(201);
    // Home defaults to the first property by name (CBD), so CBD carries the shared person.
    expect(cbd.body.amount).toBe(1_000_00 + 500_00);
    expect(vil.body.amount).toBe(2_000_00);
    expect(cbd.body.amount + vil.body.amount).toBe(1_000_00 + 2_000_00 + 500_00);
  });

  it('moving their home moves their cost, and only to a property they work in', async () => {
    asAdmin();
    const bad = await call('put', `/payroll/employees/${dual}`, {
      gross_amount: 500_00, frequency: 'MONTHLY', home_property_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(bad.status).toBe(400);
    const ok = await call('put', `/payroll/employees/${dual}`, {
      gross_amount: 500_00, frequency: 'MONTHLY', home_property_id: propVillage,
    });
    expect(ok.status).toBe(200);
    const listed = ((await call('get', '/payroll/employees')).body.data as Array<{ user_id: string; home_property_id: string | null }>)
      .find((e) => e.user_id === dual)!;
    expect(listed.home_property_id).toBe(propVillage);

    asClerk();
    expect((await call('post', '/payroll/post-to-costs', { month: MONTH_B })).body.amount).toBe(1_000_00);
    asVillageClerk();
    expect((await call('post', '/payroll/post-to-costs', { month: MONTH_B })).body.amount).toBe(2_000_00 + 500_00);
  });

  it('a limited user cannot pull a shared person’s home onto their own property', async () => {
    // dual's home is the Village now (previous test); the CBD clerk works at CBD only.
    asClerk();
    const res = await call('put', `/payroll/employees/${dual}`, { gross_amount: 500_00, frequency: 'MONTHLY', home_property_id: propCbd });
    expect(res.status).toBe(403);
    // …while the Village clerk, who holds that home, may move it.
    asVillageClerk();
    expect((await call('put', `/payroll/employees/${dual}`, { gross_amount: 500_00, frequency: 'MONTHLY', home_property_id: propVillage })).status).toBe(200);
  });

  it('a limited user cannot make a salary company-level', async () => {
    asClerk();
    const res = await call('put', `/payroll/employees/${cbdStaff}`, { gross_amount: 1_000_00, frequency: 'MONTHLY', home_property_id: null });
    expect(res.status).toBe(400);
  });
});
