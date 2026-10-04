/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R4 owner decision 2a, 2026-10-04) Rate plans are estate-wide — one STANDARD rate is
 * charged at every block — so holding pricing.create / pricing.update is not enough to
 * change one. A manager limited to some properties may read rates but not write them;
 * an admin (or a member of every active property) may.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createPricingRouter } from '../../../src/modules/pricing/pricing.routes.js';
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
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PERMS = ['pricing.read', 'pricing.create', 'pricing.update'];
let limitedUser: string, propId: string;

const as = (role: string) => { mockState.user = { sub: limitedUser, role, permissions: PERMS }; };
const auth = (r: request.Test) => r.set('Authorization', 'Bearer t');

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'operations').executeTakeFirstOrThrow()).id;
  limitedUser = (await db.insertInto('users')
    .values({ role_id: role, name: `RATE limited ${uniq}`, email: `rate-${uniq}@t.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `RATE_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  await db.insertInto('user_properties').values({ user_id: limitedUser, property_id: propId }).execute();
});

afterAll(async () => {
  await db.deleteFrom('user_properties').where('user_id', '=', limitedUser).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', limitedUser).execute();
});

describe('R4 2a — only an all-property user changes room rates', () => {
  it('lets a limited user read rates', async () => {
    as('operations');
    expect((await auth(request(app).get('/pricing'))).status).toBe(200);
  });

  it('refuses a limited user every write, in plain English', async () => {
    as('operations');
    const id = '00000000-0000-0000-0000-000000000000';
    const post = await auth(request(app).post('/pricing')).send({});
    const patch = await auth(request(app).patch(`/pricing/${id}`)).send({});
    const del = await auth(request(app).delete(`/pricing/${id}`));
    for (const res of [post, patch, del]) {
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain('Room rates apply to every property');
    }
  });

  it('lets an admin through the gate (stopped next by validation, not scope)', async () => {
    as('admin');
    const res = await auth(request(app).post('/pricing')).send({});
    expect(res.status).toBe(400);
  });
});
