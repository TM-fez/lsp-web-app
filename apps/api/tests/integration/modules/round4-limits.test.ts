/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, N-10) Money fields had no upper bound: a rate, cost or salary of P20 million+
 * overflowed the 32-bit column and crashed the save with a server error, and a typo with an
 * extra zero went straight into the books. A rate ladder where a week costs less than a night
 * was accepted too.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createPricingRouter } from '../../../src/modules/pricing/pricing.routes.js';
import { createOperatingExpensesRouter } from '../../../src/modules/operating-expenses/operating-expenses.routes.js';
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
app.use('/pricing', createPricingRouter());
app.use('/opex', createOperatingExpensesRouter());
app.use('/payroll', createPayrollRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PERMS = ['pricing.read', 'pricing.create', 'pricing.update', 'opex.create', 'payroll.manage'];
const MAX = 100_000_000;
let admin: string;
let planId: string | undefined;
const call = (method: 'post' | 'patch' | 'put', path: string, body: object) =>
  request(app)[method](path).set('Authorization', 'Bearer t').send(body);

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  admin = (await db.insertInto('users').values({ role_id: role, name: 'Limits admin', email: `lim-${uniq}@t.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
  mockState.user = { sub: admin, role: 'admin', permissions: PERMS };
});

afterAll(async () => {
  if (planId) await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', admin).execute();
  await db.deleteFrom('users').where('id', '=', admin).execute();
});

const plan = (over: object = {}) => ({
  unit_type: 'CUSTOM', name: `LIM ${uniq}`, nightly_rate: 100_000, weekly_rate: 600_000, monthly_rate: 2_400_000, active: false, ...over,
});

describe('rate plans', () => {
  it('rejects a rate above P1,000,000 instead of crashing the save', async () => {
    const res = await call('post', '/pricing', plan({ nightly_rate: 2_000_000_000_000 }));
    expect(res.status).toBe(400);
    expect((await call('post', '/pricing', plan({ monthly_rate: MAX + 1 }))).status).toBe(400);
  });

  it('rejects a week that costs less than a night, or a month less than a week', async () => {
    expect((await call('post', '/pricing', plan({ nightly_rate: 100_000, weekly_rate: 50_000 }))).status).toBe(400);
    expect((await call('post', '/pricing', plan({ weekly_rate: 600_000, monthly_rate: 500_000 }))).status).toBe(400);
  });

  it('accepts a normal ladder and the ceiling itself', async () => {
    const res = await call('post', '/pricing', plan({ nightly_rate: MAX, weekly_rate: MAX, monthly_rate: MAX }));
    expect(res.status).toBe(201);
    planId = res.body.id;
  });

  it('judges a single-rate edit against the stored rates', async () => {
    // stored: nightly = weekly = monthly = MAX → raising nothing, lowering weekly below nightly is wrong
    expect((await call('patch', `/pricing/${planId}`, { weekly_rate: 1_000 })).status).toBe(400);
    expect((await call('patch', `/pricing/${planId}`, { nightly_rate: MAX + 1 })).status).toBe(400);
    // an edit that touches no rate is never blocked
    expect((await call('patch', `/pricing/${planId}`, { name: `LIM2 ${uniq}` })).status).toBe(200);
    // lowering all three coherently works
    expect((await call('patch', `/pricing/${planId}`, { nightly_rate: 100_000, weekly_rate: 600_000, monthly_rate: 2_400_000 })).status).toBe(200);
  });
});

describe('cost and salary ceilings', () => {
  it('operating cost amount above P1,000,000 is refused', async () => {
    const body = { category: 'UTILITIES', description: 'x', incurred_on: '2033-07-11' };
    expect((await call('post', '/opex', { ...body, amount: 2_000_000_000_000 })).status).toBe(400);
    expect((await call('post', '/opex', { ...body, amount: MAX + 1 })).status).toBe(400);
    expect((await call('post', '/opex/recurring', { category: 'UTILITIES', description: 'x', amount: MAX + 1, day_of_month: 1 })).status).toBe(400);
  });

  it('a salary above P1,000,000 is refused', async () => {
    const res = await call('put', `/payroll/employees/${admin}`, { gross_amount: MAX + 1, frequency: 'MONTHLY' });
    expect(res.status).toBe(400);
  });
});
