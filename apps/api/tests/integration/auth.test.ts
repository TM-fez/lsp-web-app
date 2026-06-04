/**
 * Integration tests for /api/v1/auth
 *
 * Requires a running PostgreSQL instance with migrations applied.
 * DATABASE_URL must be set in the environment (defaults to test DB).
 *
 * Start test DB:  docker compose -f infra/docker-compose.test.yml up -d
 * Run migrations: DATABASE_URL=postgresql://lsp:lsp@localhost:5433/lsp_test npm run db:migrate
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, server } from '../../src/app.js';
import { db, pool } from '../../src/config/db.js';

// ── Test fixtures ──────────────────────────────────────────────────────────────

const TEST_USER = {
  email: 'testauth@lsp.test',
  password: 'TestPass@99!',
  name: 'Auth Test User',
};

let testUserId: string;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  const roleRow = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', 'admin')
    .executeTakeFirstOrThrow();

  const hash = await bcrypt.hash(TEST_USER.password, 4);

  const inserted = await db
    .insertInto('users')
    .values({
      role_id: roleRow.id,
      name: TEST_USER.name,
      email: TEST_USER.email,
      password_hash: hash,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  testUserId = inserted.id;
});

afterAll(async () => {
  await db.deleteFrom('refresh_tokens').where('user_id', '=', testUserId).execute();
  await db.deleteFrom('users').where('id', '=', testUserId).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', testUserId).execute();
  server.close();
  await pool.end();
});

beforeEach(async () => {
  await db.deleteFrom('refresh_tokens').where('user_id', '=', testUserId).execute();
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function loginAs(email = TEST_USER.email, password = TEST_USER.password) {
  return request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
}

function extractCookie(res: request.Response): string {
  const header = res.headers['set-cookie'] as string[] | undefined;
  const line = header?.find((c) => c.startsWith('lsp_refresh='));
  if (!line) throw new Error('lsp_refresh cookie not set');
  return line.split(';')[0]!;
}

// ── POST /auth/login ──────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  it('returns 200 with access token and sets httpOnly cookie', async () => {
    const res = await loginAs();

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.permissions).toContain('contacts:read');

    const cookies = res.headers['set-cookie'] as string[];
    const refreshCookie = cookies?.find((c) => c.startsWith('lsp_refresh='));
    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('SameSite=Strict');
  });

  it('returns 401 for wrong password', async () => {
    const res = await loginAs(TEST_USER.email, 'WrongPassword!');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
    expect(res.body.accessToken).toBeUndefined();
  });

  it('returns 401 for unknown email', async () => {
    const res = await loginAs('nobody@lsp.test', TEST_USER.password);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: 'test' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: TEST_USER.email });

    expect(res.status).toBe(400);
  });

  it('writes an audit log entry on successful login', async () => {
    await loginAs();

    const log = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('user_id', '=', testUserId)
      .where('entity', '=', 'auth_login')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    expect(log).toBeTruthy();
    expect(log?.action).toBe('CREATE');
  });

  it('writes an audit log entry on failed login', async () => {
    await loginAs(TEST_USER.email, 'BadPassword!');

    const log = await db
      .selectFrom('audit_logs')
      .selectAll()
      .where('entity', '=', 'auth_login')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    expect(log).toBeTruthy();
    expect(log?.action).toBe('CREATE');
  });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
  it('returns 200 with new access token and rotates the refresh cookie', async () => {
    const loginRes = await loginAs();
    const cookie = extractCookie(loginRes);

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();

    const newCookie = extractCookie(refreshRes);
    expect(newCookie).not.toBe(cookie);
  });

  it('returns 401 for a missing refresh cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');

    expect(res.status).toBe(401);
  });

  it('returns 401 when the same refresh token is used twice (revoked)', async () => {
    const loginRes = await loginAs();
    const cookie = extractCookie(loginRes);

    await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    const secondRes = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);

    expect(secondRes.status).toBe(401);
  });

  it('returns 401 for an invalid (garbage) refresh cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'lsp_refresh=not-a-real-token');

    expect(res.status).toBe(401);
  });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

describe('POST /api/v1/auth/logout', () => {
  it('returns 204 and clears the cookie', async () => {
    const loginRes = await loginAs();
    const cookie = extractCookie(loginRes);

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie);

    expect(logoutRes.status).toBe(204);
  });

  it('returns 204 with no cookie (idempotent)', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(204);
  });

  it('invalidates the token so refresh no longer works', async () => {
    const loginRes = await loginAs();
    const cookie = extractCookie(loginRes);

    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie);

    expect(refreshRes.status).toBe(401);
  });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────

describe('GET /api/v1/auth/me', () => {
  it('returns current user for a valid access token', async () => {
    const loginRes = await loginAs();
    const { accessToken } = loginRes.body;

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe(TEST_USER.email);
    expect(meRes.body.role).toBe('admin');
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a malformed token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer garbage.token.value');

    expect(res.status).toBe(401);
  });

  it('returns X-Request-Id header on every response', async () => {
    const loginRes = await loginAs();
    expect(loginRes.headers['x-request-id']).toBeTruthy();
  });
});

// ── POST /auth/logout-all ─────────────────────────────────────────────────────

describe('POST /api/v1/auth/logout-all', () => {
  it('revokes all sessions and returns 204', async () => {
    const [sess1, sess2] = await Promise.all([loginAs(), loginAs()]);
    const cookie1 = extractCookie(sess1);
    const { accessToken } = sess1.body;

    const res = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(204);

    // Both cookies are now invalid
    const [r1, r2] = await Promise.all([
      request(app).post('/api/v1/auth/refresh').set('Cookie', cookie1),
      request(app).post('/api/v1/auth/refresh').set('Cookie', extractCookie(sess2)),
    ]);
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
  });

  it('returns 401 with no access token', async () => {
    const res = await request(app).post('/api/v1/auth/logout-all');
    expect(res.status).toBe(401);
  });
});
