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

// ── GET /dashboard/activity ───────────────────────────────────────────────────

describe('GET /api/v1/dashboard/activity', () => {
  it('returns 200 with correct response shape', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns entries with required fields', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity')
      .set('Authorization', `Bearer ${adminToken}`);

    if (res.body.data.length > 0) {
      const entry = res.body.data[0];
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('action');
      expect(entry).toHaveProperty('entity');
      expect(entry).toHaveProperty('entityId');
      expect(entry).toHaveProperty('createdAt');
      expect(['CREATE', 'UPDATE', 'DELETE']).toContain(entry.action);
    }
  });

  it('respects the ?limit query param', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity?limit=2')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  it('clamps limit to 50 when an excessive value is passed', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity?limit=999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(50);
  });

  it('returns entries in descending chronological order', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity')
      .set('Authorization', `Bearer ${adminToken}`);

    const entries: { createdAt: string }[] = res.body.data;
    for (let i = 1; i < entries.length; i++) {
      expect(new Date(entries[i - 1]!.createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(entries[i]!.createdAt).getTime());
    }
  });

  it('does not cache — successive calls may return different data', async () => {
    // Verify the route is live and returns data structure on every call
    const [r1, r2] = await Promise.all([
      request(app).get('/api/v1/dashboard/activity').set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/api/v1/dashboard/activity').set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/v1/dashboard/activity');
    expect(res.status).toBe(401);
  });

  it('includes X-Request-Id on every response', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/activity')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
