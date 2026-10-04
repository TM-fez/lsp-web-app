/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, N-8) POST /operating-expenses/recurring/generate ran EVERY active template in
 * the house for any caller with opex.create — a CBD-only accounts user posted Village (and
 * company-level) costs to the ledger. It now generates only from the caller's own
 * properties' templates; company-level templates run only for someone who can see every
 * property.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createOperatingExpensesRouter } from '../../../src/modules/operating-expenses/operating-expenses.routes.js';
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
app.use('/opex', createOperatingExpensesRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PERMS = ['opex.read', 'opex.create', 'opex.update', 'opex.delete'];
let clerk: string, propCbd: string, propVillage: string;
let tplCbd: string, tplVillage: string, tplCompany: string;
const MONTH = '2031-05';
const MONTH_ADMIN = '2031-06';

const asClerk = () => { mockState.user = { sub: clerk, role: 'accounts', permissions: PERMS }; };
const asAdmin = () => { mockState.user = { sub: clerk, role: 'admin', permissions: PERMS }; };
const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) =>
  request(app)[method](path).set('Authorization', 'Bearer t').send(body);

const generatedFor = async (tpl: string, month: string) =>
  (await db.selectFrom('operating_expenses').select('id').where('notes', '=', `recurring:${tpl}:${month}`).execute()).length;

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'accounts').executeTakeFirstOrThrow()).id;
  clerk = (await db.insertInto('users').values({ role_id: role, name: 'Gen clerk', email: `gen-${uniq}@t.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
  propCbd = (await db.insertInto('properties').values({ name: `GN_CBD_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  propVillage = (await db.insertInto('properties').values({ name: `GN_VIL_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  await db.insertInto('user_properties').values({ user_id: clerk, property_id: propCbd }).execute();
  const tpl = async (property_id: string | null, tag: string) =>
    (await db.insertInto('recurring_operating_costs').values({
      property_id, category: 'UTILITIES', description: `GN ${tag} ${uniq}`, amount: 1500, day_of_month: 5,
      created_by: clerk, updated_by: clerk,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  tplCbd = await tpl(propCbd, 'cbd');
  tplVillage = await tpl(propVillage, 'village');
  tplCompany = await tpl(null, 'company');
});

afterAll(async () => {
  await db.deleteFrom('operating_expenses').where('created_by', '=', clerk).execute();
  await db.deleteFrom('recurring_operating_costs').where('id', 'in', [tplCbd, tplVillage, tplCompany]).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', clerk).execute();
  await db.deleteFrom('user_properties').where('user_id', '=', clerk).execute();
  await db.deleteFrom('properties').where('id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('users').where('id', '=', clerk).execute();
});

describe('POST /operating-expenses/recurring/generate', () => {
  it('a CBD-only user generates only their own property’s templates', async () => {
    asClerk();
    const res = await call('post', '/opex/recurring/generate', { month: MONTH });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    expect(res.body.templates).toBe(1);
    expect(await generatedFor(tplCbd, MONTH)).toBe(1);
    expect(await generatedFor(tplVillage, MONTH)).toBe(0);
    expect(await generatedFor(tplCompany, MONTH)).toBe(0);
  });

  it('is still re-runnable: a second run skips what exists', async () => {
    asClerk();
    const res = await call('post', '/opex/recurring/generate', { month: MONTH });
    expect(res.body).toMatchObject({ created: 0, skipped: 1 });
  });

  it('an all-property user (admin) generates every template, company-level included', async () => {
    asAdmin();
    const res = await call('post', '/opex/recurring/generate', { month: MONTH_ADMIN });
    expect(res.status).toBe(201);
    expect(await generatedFor(tplCbd, MONTH_ADMIN)).toBe(1);
    expect(await generatedFor(tplVillage, MONTH_ADMIN)).toBe(1);
    expect(await generatedFor(tplCompany, MONTH_ADMIN)).toBe(1);
  });
});

describe('recurring templates stay scoped', () => {
  it('a CBD-only user cannot see, edit, delete or create against another property’s template', async () => {
    asClerk();
    const ids = ((await call('get', '/opex/recurring')).body.data as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(tplCbd);
    expect(ids).not.toContain(tplVillage);
    expect(ids).not.toContain(tplCompany);
    expect((await call('patch', `/opex/recurring/${tplVillage}`, { amount: 1 })).status).toBe(404);
    expect((await call('delete', `/opex/recurring/${tplVillage}`)).status).toBe(404);
    expect((await call('patch', `/opex/recurring/${tplCompany}`, { amount: 1 })).status).toBe(404);
    const base = { category: 'UTILITIES', description: 'x', amount: 500, day_of_month: 3 };
    expect((await call('post', '/opex/recurring', { ...base, property_id: propVillage })).status).toBe(403);
    expect((await call('post', '/opex/recurring', base)).status).toBe(403);
  });
});
