/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4) One paging rule: a limit above 100 (or below 1, or not a number) is refused with a 400
 * on every big list, the same way /invoices already did — instead of being silently trimmed on
 * some lists. The smaller lists (expenses, operating costs, users, payroll) gained OPT-IN paging:
 * with no ?limit / ?page they return everything exactly as before.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createReservationsRouter } from '../../../src/modules/reservations/reservations.routes.js';
import { createPaymentsRouter } from '../../../src/modules/payments/payments.routes.js';
import { createContactsRouter } from '../../../src/modules/crm/contacts/contacts.routes.js';
import { createQuotesRouter } from '../../../src/modules/quotes/quotes.routes.js';
import { createUsersRouter } from '../../../src/modules/users/users.routes.js';
import { createPayrollRouter } from '../../../src/modules/payroll/payroll.routes.js';
import { createExpensesRouter } from '../../../src/modules/expenses/expenses.routes.js';
import { createOperatingExpensesRouter } from '../../../src/modules/operating-expenses/operating-expenses.routes.js';
import { createInvoicesRouter } from '../../../src/modules/invoices/invoices.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ user: null as any }));
vi.mock('jsonwebtoken', () => ({
  default: { verify: () => { if (!mockState.user) throw new Error('jwt malformed'); return mockState.user; } },
}));
const app = express();
app.use(express.json());
app.use('/reservations', createReservationsRouter());
app.use('/payments', createPaymentsRouter());
app.use('/contacts', createContactsRouter());
app.use('/quotes', createQuotesRouter());
app.use('/users', createUsersRouter());
app.use('/payroll', createPayrollRouter());
app.use('/expenses', createExpensesRouter());
app.use('/operating-expenses', createOperatingExpensesRouter());
app.use('/invoices', createInvoicesRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, propertyId: string;
const get = (path: string) => request(app).get(path).set('Authorization', 'Bearer t').set('X-Property-Id', propertyId);

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'PG', email: `pg-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propertyId = (await db.insertInto('properties').values({ name: `PG_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  mockState.user = {
    sub: userId, role: 'admin',
    permissions: ['reservations.read', 'payments.read', 'crm.contacts.read', 'quotes.read', 'users.read', 'payroll.read', 'expenses.read', 'opex.read', 'invoices.read'],
  };
});
afterAll(async () => {
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('one paging rule on the big lists', () => {
  for (const path of ['/reservations', '/payments', '/contacts', '/quotes']) {
    it(`${path} refuses limit=101, limit=0 and limit=abc with a plain 400`, async () => {
      for (const bad of ['101', '0', 'abc', '-5']) {
        const res = await get(`${path}?limit=${bad}`);
        expect(res.status, `${path} limit=${bad}`).toBe(400);
        expect(res.body.error?.message ?? res.body.message).toMatch(/limit/i);
      }
      expect((await get(`${path}?page=0`)).status).toBe(400);
    });
    it(`${path} still answers with its defaults and with limit=100`, async () => {
      expect((await get(path)).status).toBe(200);
      const res = await get(`${path}?limit=100&page=1`);
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(100);
    });
  }
});

describe('opt-in paging on the small lists', () => {
  const lists = ['/users', '/payroll/employees', '/expenses', '/operating-expenses'];
  for (const path of lists) {
    it(`${path} without limit/page returns the whole list as before`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total ?? res.body.data.length).toBeGreaterThanOrEqual(res.body.data.length);
      expect(res.body.data.length).toBe(res.body.total);
    });
    it(`${path}?limit=1 returns one row but reports the true total; limit>100 is refused`, async () => {
      const all = await get(path);
      const one = await get(`${path}?limit=1&page=1`);
      expect(one.status).toBe(200);
      expect(one.body.data.length).toBe(Math.min(1, all.body.total));
      expect(one.body.total).toBe(all.body.total);
      expect(one.body.limit).toBe(1);
      expect((await get(`${path}?limit=101`)).status).toBe(400);
    });
  }
});

describe('/invoices totals are labelled', () => {
  it('says in words that the owed totals ignore the status tab, and they do', async () => {
    const paid = await get('/invoices?status=PAID');
    const all = await get('/invoices');
    expect(paid.status).toBe(200);
    expect(paid.body.totals.scope).toMatch(/ignores the status/i);
    expect(paid.body.totals.outstanding_amount).toBe(all.body.totals.outstanding_amount);
    expect(paid.body.limit).toBeLessThanOrEqual(100);
  });
});
