/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, H10) Company-level operating costs (no property) were hidden from an accounts
 * user who belongs to BOTH properties, so their P&L silently differed from admin's. The
 * rule is now explicit: someone who can see every property sees company-level costs, like
 * admin; someone limited to some properties does not, and the response says so in
 * `scope_note`.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createReportsRouter } from '../../../src/modules/reports/reports.routes.js';
import { createOperatingExpensesRouter } from '../../../src/modules/operating-expenses/operating-expenses.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ user: null as any, forceAllProperties: false, ids: [] as string[] }));
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: () => {
      if (!mockState.user) throw new Error('jwt malformed');
      return mockState.user;
    },
  },
}));
// A user with a membership in EVERY active property cannot be built reliably against a
// shared test database (other suites open and close properties at the same time), so the
// "sees every property" decision is stubbed here; its real logic is unit-tested in
// tests/unit/core/propertyScope.test.ts. Everything else uses the real implementation.
vi.mock('../../../src/core/scope/propertyScope.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/scope/propertyScope.js')>();
  return {
    ...actual,
    propertyScopeForUser: (...args: Parameters<typeof actual.propertyScopeForUser>) =>
      mockState.forceAllProperties
        ? Promise.resolve({ ids: mockState.ids, allProperties: true })
        : actual.propertyScopeForUser(...args),
  };
});

const app = express();
app.use(express.json());
app.use('/reports', createReportsRouter());
app.use('/opex', createOperatingExpensesRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// A far-away window so nothing else in the shared DB lands in it.
const FROM = '2033-07-01';
const TO = '2033-07-31';
const PERMS = ['reports.read', 'opex.read', 'opex.create', 'opex.update', 'opex.delete'];
let clerk: string, propCbd: string, propVillage: string;

const as = (role: string, forceAll = false) => {
  mockState.user = { sub: clerk, role, permissions: PERMS };
  mockState.forceAllProperties = forceAll;
};
const asAdmin = () => as('admin');
const asCbdOnly = () => as('accounts');
const asBothProperties = () => as('accounts', true);
const pnl = async () =>
  (await request(app).get(`/reports/pnl?from=${FROM}&to=${TO}`).set('Authorization', 'Bearer t')).body;

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'accounts').executeTakeFirstOrThrow()).id;
  clerk = (await db.insertInto('users').values({ role_id: role, name: 'PnL clerk', email: `pnl-${uniq}@t.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
  propCbd = (await db.insertInto('properties').values({ name: `PL_CBD_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  propVillage = (await db.insertInto('properties').values({ name: `PL_VIL_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  mockState.ids = [propCbd, propVillage];
  await db.insertInto('user_properties').values({ user_id: clerk, property_id: propCbd }).execute();
  const cost = (property_id: string | null, amount: number) =>
    db.insertInto('operating_expenses').values({
      property_id, category: 'UTILITIES', description: `PL ${uniq}`, amount, incurred_on: new Date('2033-07-10'),
      created_by: clerk, updated_by: clerk,
    } as never).execute();
  await cost(propCbd, 100_00);
  await cost(propVillage, 200_00);
  await cost(null, 400_00); // company-level
});

afterAll(async () => {
  await db.deleteFrom('operating_expenses').where('created_by', '=', clerk).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', clerk).execute();
  await db.deleteFrom('user_properties').where('user_id', '=', clerk).execute();
  await db.deleteFrom('properties').where('id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('users').where('id', '=', clerk).execute();
});

describe('P&L company-level costs', () => {
  it('admin sees every cost, including the company-level one, with no scope note', async () => {
    asAdmin();
    const r = await pnl();
    expect(r.summary.operating_expenses).toBe(700_00);
    expect(r.scope_note).toBeNull();
  });

  it('a user limited to CBD sees only CBD costs and is told company-level costs are excluded', async () => {
    asCbdOnly();
    const r = await pnl();
    expect(r.summary.operating_expenses).toBe(100_00);
    expect(r.scope_note).toMatch(/company-level costs/i);
    expect((r.by_property as Array<{ property_id: string | null }>).some((p) => p.property_id === null)).toBe(false);
  });

  it('an accounts user who can see every property matches admin exactly', async () => {
    asAdmin();
    const admin = await pnl();
    asBothProperties();
    const both = await pnl();
    expect(both.summary.operating_expenses).toBe(admin.summary.operating_expenses);
    expect(both.summary.net).toBe(admin.summary.net);
    expect(both.by_property).toEqual(admin.by_property);
    expect(both.scope_note).toBeNull();
  });
});

describe('the operating-cost list and company-level rows follow the same rule', () => {
  const list = async () =>
    ((await request(app).get(`/opex?from=${FROM}&to=${TO}`).set('Authorization', 'Bearer t')).body.data as Array<{ amount: number }>)
      .map((r) => r.amount).sort((a, b) => a - b);

  it('a limited user lists only their property’s costs', async () => {
    asCbdOnly();
    expect(await list()).toEqual([100_00]);
  });

  it('an every-property user lists all three, company-level included', async () => {
    asBothProperties();
    expect(await list()).toEqual([100_00, 200_00, 400_00]);
  });

  it('only an every-property user may add a company-level cost', async () => {
    const body = { category: 'UTILITIES', description: 'company', amount: 500, incurred_on: '2033-07-11' };
    asCbdOnly();
    expect((await request(app).post('/opex').set('Authorization', 'Bearer t').send(body)).status).toBe(403);
    asBothProperties();
    expect((await request(app).post('/opex').set('Authorization', 'Bearer t').send(body)).status).toBe(201);
  });
});
