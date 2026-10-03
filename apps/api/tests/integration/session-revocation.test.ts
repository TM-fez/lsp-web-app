/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (H7) Logging out, being deactivated or being demoted used to leave the 15-minute access
 * token working until it expired. Each case below holds an access token, changes the
 * world under it, and asserts the very next request is refused — through the real app,
 * real JWTs and the real refresh cookie.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../../src/app.js';
import { db } from '../../src/config/db.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'SessionPass@99!';
const userIds: string[] = [];

async function makeUser(tag: string, role = 'admin'): Promise<{ id: string; email: string }> {
  const roleRow = await db.selectFrom('roles').select('id').where('name', '=', role).executeTakeFirstOrThrow();
  const email = `h7-${tag}-${uniq}@lsp.test`;
  const row = await db
    .insertInto('users')
    .values({ role_id: roleRow.id, name: `H7 ${tag}`, email, password_hash: await bcrypt.hash(PASSWORD, 4) })
    .returning('id')
    .executeTakeFirstOrThrow();
  userIds.push(row.id);
  return { id: row.id, email };
}

async function login(email: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lsp_refresh='))!.split(';')[0]!;
  return { token: res.body.accessToken as string, cookie };
}

const me = (token: string) => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  // nothing shared — each case makes its own user, so they cannot disturb one another
});

afterAll(async () => {
  await db.deleteFrom('refresh_tokens').where('user_id', 'in', userIds).execute();
  await db.deleteFrom('audit_logs').where('user_id', 'in', userIds).execute();
  await db.deleteFrom('users').where('id', 'in', userIds).execute();
});

describe('H7: an access token stops working when its session ends', () => {
  it('logout ends the session for the token it issued — at once, not in 15 minutes', async () => {
    const u = await makeUser('logout');
    const { token, cookie } = await login(u.email);
    expect((await me(token)).status).toBe(200);

    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);

    const after = await me(token);
    expect(after.status).toBe(401);
    expect(after.body.message).toMatch(/session has ended/i);
  });

  it('a refresh rotation keeps the same session alive — old and new access tokens both work', async () => {
    const u = await makeUser('rotate');
    const { token, cookie } = await login(u.email);
    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);

    expect((await me(token)).status).toBe(200);
    expect((await me(refreshed.body.accessToken)).status).toBe(200);
  });

  it('deactivating a user cuts them off on their next request', async () => {
    const u = await makeUser('deactivate');
    const { token } = await login(u.email);
    await db.updateTable('users').set({ active: false }).where('id', '=', u.id).execute();

    const res = await me(token);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/inactive/i);
  });

  it('demoting a user refuses the old token; a refresh issues one with the new permissions', async () => {
    const u = await makeUser('demote', 'admin');
    const { token, cookie } = await login(u.email);
    const housekeeping = await db.selectFrom('roles').select('id').where('name', '=', 'housekeeping').executeTakeFirstOrThrow();
    await db.updateTable('users').set({ role_id: housekeeping.id }).where('id', '=', u.id).execute();

    const res = await me(token);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/access has changed/i);

    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.role).toBe('housekeeping');
    expect((await me(refreshed.body.accessToken)).status).toBe(200);
  });
});
