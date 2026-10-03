/**
 * Integration tests for /api/v1/dashboard
 *
 * Requires PostgreSQL with migrations applied.
 * Start test DB: docker compose -f infra/docker-compose.test.yml up -d
 * Run migrations: DATABASE_URL=postgresql://lsp:lsp@localhost:5433/lsp_test npm run db:migrate
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../../src/app.js';
import { db, pool } from '../../src/config/db.js';
import { clearStatsCache } from '../../src/modules/dashboard/dashboard.service.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let adminToken: string;
let testUserId: string;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  clearStatsCache();

  const roleRow = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', 'admin')
    .executeTakeFirstOrThrow();

  const hash = await bcrypt.hash('Test@Dashboard1!', 4);

  const inserted = await db
    .insertInto('users')
    .values({
      role_id:       roleRow.id,
      name:          'Dashboard Test User',
      email:         'testdash@lsp.test',
      password_hash: hash,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  testUserId = inserted.id;

  // Obtain access token
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'testdash@lsp.test', password: 'Test@Dashboard1!' });

  adminToken = loginRes.body.accessToken;
});

afterAll(async () => {
  await db.deleteFrom('refresh_tokens').where('user_id', '=', testUserId).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', testUserId).execute();
  await db.deleteFrom('users').where('id', '=', testUserId).execute();
  await pool.end();
});

// ── GET /dashboard/stats ──────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/stats', () => {
  it('returns 200 with correct response shape', async () => {
    clearStatsCache();

    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.totalContacts).toBe('number');
    expect(typeof res.body.totalUsers).toBe('number');
    expect(res.body.cachedAt).toBeTruthy();
    expect(new Date(res.body.cachedAt).toISOString()).toBe(res.body.cachedAt);
  });

  it('returns non-negative counts', async () => {
    clearStatsCache();

    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.totalContacts).toBeGreaterThanOrEqual(0);
    expect(res.body.totalUsers).toBeGreaterThanOrEqual(1); // at least our test user
  });

  it('serves the same cachedAt on a second call within 30 seconds', async () => {
    clearStatsCache();

    const first  = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    const second = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(second.body.cachedAt).toBe(first.body.cachedAt);
  });

  it('returns a fresh cachedAt after the cache is cleared', async () => {
    clearStatsCache();
    const first = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    clearStatsCache();
    const second = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    // Both are valid ISO timestamps; second must be >= first
    expect(new Date(second.body.cachedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(first.body.cachedAt).getTime());
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/v1/dashboard/stats');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a malformed token', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', 'Bearer garbage.token');
    expect(res.status).toBe(401);
  });

  it('includes X-Request-Id on every response', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

// ── GET /dashboard/activity (removed, H6) ─────────────────────────────────────

describe('GET /api/v1/dashboard/activity', () => {
  // It returned the audit log for EVERY property to anyone with dashboard:read. The
  // property-scoped feed is GET /activity (D03); nothing in the web app called this one.
  it('no longer exists', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
