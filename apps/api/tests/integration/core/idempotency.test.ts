/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test, migration 081).
 *
 * The shared Idempotency-Key middleware, proven against real SQL and real concurrency on a tiny
 * Express app: a counter endpoint stands in for "move money", so "ran once" is a number.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { idempotent } from '../../../src/core/middleware/idempotency.middleware.js';
import { AppError } from '../../../src/core/errors/AppError.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userA = '';
let userB = '';

let runs = 0;
let behaviour: 'ok' | 'fail' | 'slow' = 'ok';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Stand-in for authenticate: the caller says who they are.
  app.use((req, _res, next) => {
    req.user = { sub: req.get('x-test-user') ?? userA } as never;
    next();
  });
  const run = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      runs += 1;
      const n = runs;
      if (behaviour === 'slow') await new Promise((r) => setTimeout(r, 300));
      if (behaviour === 'fail') throw AppError.conflict('Only P10.00 is left to refund.');
      res.status(201).json({ ran: n, echo: req.body });
    } catch (e) {
      next(e);
    }
  };
  app.post('/things', idempotent(db), run);
  app.post('/things/:id/act', idempotent(db), run);
  app.use(errorHandler);
  return app;
}
const app = buildApp();
const key = (suffix: string) => `idem-${uniq}-${suffix}`;

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const mk = async (n: string) =>
    (await db.insertInto('users').values({ role_id: role.id, name: `Idem ${n}`, email: `idem-${n}-${uniq}@test.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()).id;
  userA = await mk('a');
  userB = await mk('b');
});
beforeEach(() => {
  runs = 0;
  behaviour = 'ok';
});
afterAll(async () => {
  await db.deleteFrom('idempotency_keys').where('user_id', 'in', [userA, userB]).execute();
  await db.deleteFrom('users').where('id', 'in', [userA, userB]).execute();
});

describe('Idempotency-Key middleware', () => {
  // (R5 retest) No key used to mean no protection. Now the request's own fingerprint is
  // the key for IMPLICIT_TTL_SECONDS: a double click replays, a different body is new work.
  it('without a key, the same request twice in a row runs once and replays', async () => {
    const body = { x: `implicit-${uniq}` };
    const a = await request(app).post('/things').send(body);
    const b = await request(app).post('/things').send(body);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body).toEqual(a.body);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(runs).toBe(1);
  });

  it('without a key, a different request is new work', async () => {
    await request(app).post('/things').send({ x: `implicit-a-${uniq}` });
    await request(app).post('/things').send({ x: `implicit-b-${uniq}` });
    expect(runs).toBe(2);
  });

  it('without a key, the same request after the short window is new work', async () => {
    const body = { x: `implicit-later-${uniq}` };
    await request(app).post('/things').send(body);
    // Age the implicit claim past its window instead of waiting 10 s.
    await db.updateTable('idempotency_keys').set({ expires_at: sql`now() - interval '1 second'` } as never)
      .where('key', 'like', 'implicit:%').execute();
    await request(app).post('/things').send(body);
    expect(runs).toBe(2);
  });

  it('the same key replays the stored response and does not run the handler again', async () => {
    const k = key('replay');
    const first = await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 5 });
    const second = await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 5 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(runs).toBe(1);
  });

  it('the same key with a different body is 422 and does not run the handler', async () => {
    const k = key('mismatch');
    await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 5 });
    const other = await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 6 });
    expect(other.status).toBe(422);
    expect(other.body.message).toMatch(/already used for a different request/);
    expect(runs).toBe(1);
  });

  it('the same key on another resource (route params) is also 422', async () => {
    const k = key('params');
    await request(app).post('/things/one/act').set('Idempotency-Key', k).send({});
    const other = await request(app).post('/things/two/act').set('Idempotency-Key', k).send({});
    expect(other.status).toBe(422);
    expect(runs).toBe(1);
  });

  it('4 parallel requests with one key run the handler exactly once and all get the same answer', async () => {
    behaviour = 'slow';
    const k = key('parallel');
    const out = await Promise.all(Array.from({ length: 4 }, () => request(app).post('/things').set('Idempotency-Key', k).send({ amount: 100 })));
    expect(runs).toBe(1);
    expect(out.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(out.map((r) => r.body.ran))).toEqual(new Set([1]));
    expect(out.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(3);
  });

  it('a failed request releases its key, so the corrected form can be sent with the same key', async () => {
    const k = key('retry');
    behaviour = 'fail';
    const bad = await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 99_999 });
    expect(bad.status).toBe(409);
    behaviour = 'ok';
    const good = await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 100 });
    expect(good.status).toBe(201);
    expect(good.headers['idempotent-replayed']).toBeUndefined();
    expect(runs).toBe(2);
  });

  it('keys are per user: the same key from another user is its own request', async () => {
    const k = key('users');
    const a = await request(app).post('/things').set('Idempotency-Key', k).set('x-test-user', userA).send({ amount: 1 });
    const b = await request(app).post('/things').set('Idempotency-Key', k).set('x-test-user', userB).send({ amount: 1 });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(runs).toBe(2);
  });

  it('a malformed key is a 400', async () => {
    const res = await request(app).post('/things').set('Idempotency-Key', 'no').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/8 to 128 characters/);
    expect(runs).toBe(0);
  });

  it('keys expire after 24 hours: an expired key is re-claimed and runs again', async () => {
    const k = key('expiry');
    await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 1 });
    const row = await db.selectFrom('idempotency_keys').select(['expires_at', 'created_at']).where('key', '=', k).executeTakeFirstOrThrow();
    const hours = (row.expires_at.getTime() - row.created_at.getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(24);

    await db.updateTable('idempotency_keys').set({ expires_at: new Date(Date.now() - 1000) }).where('key', '=', k).execute();
    const again = await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 2 }); // even with a different body
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBeUndefined();
    expect(runs).toBe(2);
  });

  it('an abandoned in-progress claim is never taken over — the caller is told to check and use a new key', async () => {
    const k = key('stale');
    await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 1 });
    await db.updateTable('idempotency_keys')
      .set({ state: 'IN_PROGRESS', response_status: null, response_body: null, created_at: new Date(Date.now() - 10 * 60_000) })
      .where('key', '=', k).execute();
    const res = await request(app).post('/things').set('Idempotency-Key', k).send({ amount: 1 });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/may or may not have gone through/);
    expect(runs).toBe(1);
  });
});
