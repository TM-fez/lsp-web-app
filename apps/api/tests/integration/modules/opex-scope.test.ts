/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Re-test round 3) Operating costs: the list was property-scoped but the by-id routes
 * were not — a CBD-only accounts user could read, edit, delete and create Village rows.
 * And the property list showed every property to a property-limited user.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createOperatingExpensesRouter } from '../../../src/modules/operating-expenses/operating-expenses.routes.js';
import { createPropertiesRouter } from '../../../src/modules/properties/properties.routes.js';
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
app.use('/properties', createPropertiesRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let clerk: string, propCbd: string, propVillage: string, villageRow: string, cbdRow: string;
const created: string[] = [];

const PERMS = ['opex.read', 'opex.create', 'opex.update', 'opex.delete', 'properties.read'];
const asClerk = () => { mockState.user = { sub: clerk, role: 'accounts', permissions: PERMS }; };
const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) =>
  request(app)[method](path).set('Authorization', 'Bearer t').send(body);

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'accounts').executeTakeFirstOrThrow()).id;
  clerk = (await db.insertInto('users').values({ role_id: role, name: 'Opex clerk', email: `opex-${uniq}@t.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
  propCbd = (await db.insertInto('properties').values({ name: `OX_CBD_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  propVillage = (await db.insertInto('properties').values({ name: `OX_VIL_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  await db.insertInto('user_properties').values({ user_id: clerk, property_id: propCbd }).execute();
  const row = async (property_id: string) =>
    (await db.insertInto('operating_expenses').values({
      property_id, category: 'UTILITIES', description: `OX ${uniq}`, amount: 1000, incurred_on: new Date('2026-09-01'),
      created_by: clerk, updated_by: clerk,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  villageRow = await row(propVillage);
  cbdRow = await row(propCbd);
});

afterAll(async () => {
  await db.deleteFrom('operating_expenses').where('id', 'in', [villageRow, cbdRow, ...created]).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', clerk).execute();
  await db.deleteFrom('user_properties').where('user_id', '=', clerk).execute();
  await db.deleteFrom('properties').where('id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('users').where('id', '=', clerk).execute();
});

describe('operating costs by id follow the same property scope as the list', () => {
  it('another property’s row is "not found" — to read, edit and delete', async () => {
    asClerk();
    expect((await call('get', `/opex/${villageRow}`)).status).toBe(404);
    expect((await call('patch', `/opex/${villageRow}`, { description: 'hijack' })).status).toBe(404);
    expect((await call('delete', `/opex/${villageRow}`)).status).toBe(404);
    const still = await db.selectFrom('operating_expenses').select(['description', 'deleted_at']).where('id', '=', villageRow).executeTakeFirstOrThrow();
    expect(still).toEqual({ description: `OX ${uniq}`, deleted_at: null });
  });

  it('their own property’s row works as before', async () => {
    asClerk();
    expect((await call('get', `/opex/${cbdRow}`)).status).toBe(200);
    expect((await call('patch', `/opex/${cbdRow}`, { description: 'ok' })).status).toBe(200);
  });

  it('cannot create against, or move a row to, another property (or no property)', async () => {
    asClerk();
    const base = { category: 'UTILITIES', description: 'x', amount: 500, incurred_on: '2026-09-02' };
    expect((await call('post', '/opex', { ...base, property_id: propVillage })).status).toBe(403);
    expect((await call('post', '/opex', base)).status).toBe(403);
    expect((await call('patch', `/opex/${cbdRow}`, { property_id: propVillage })).status).toBe(403);
    const ok = await call('post', '/opex', { ...base, property_id: propCbd });
    expect(ok.status).toBe(201);
    created.push(ok.body.id);
  });
});

describe('the property list', () => {
  it('shows a property-limited user only their own properties', async () => {
    asClerk();
    const ids = ((await call('get', '/properties')).body as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(propCbd);
    expect(ids).not.toContain(propVillage);
  });
});
