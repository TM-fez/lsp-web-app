import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { Kysely, sql } from 'kysely';
import { db as defaultDb } from '../../config/db.js';
import type { Database } from '../../db/types.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../logger.js';

/**
 * ── Idempotency-Key: one shared guard against double-submit (migration 081). ─────────
 *
 * A double-click, a browser retry on a flaky connection or a second tab sends the SAME
 * request twice. For "refund P100" or "record a payment" that is money moving twice. The
 * client sends `Idempotency-Key: <random>` (one per dialog open); the first request with a
 * key does the work and this stores its response, and any later request with the same key
 * gets that response back without running the handler again.
 *
 * Rules (kept deliberately small — the whole contract fits here):
 *  - No header → the middleware does nothing. The key is optional (API clients that don't
 *    send one behave exactly as before); the refund endpoint adds its own duplicate guard.
 *  - Scope: (user, route pattern, key). The same key from another user or on another
 *    endpoint is a different request.
 *  - Same key, different body / params / property → 422. That is a client bug (a key was
 *    reused for something else), never a replay.
 *  - Only 2xx responses are kept. A request that failed releases its key, so the user can
 *    fix the form and submit again with the same dialog key.
 *  - A duplicate that arrives while the first is still running WAITS for it and replays its
 *    response — it never runs the handler a second time.
 *  - Keys expire after 24 hours; an expired key is re-claimed by the next request.
 *  - If the first attempt died mid-flight (server restart) its key stays IN_PROGRESS. We do
 *    NOT take it over after a while: we cannot know whether the money moved, and guessing
 *    wrong is exactly the double-charge this exists to prevent. The caller gets a 409 telling
 *    them to check the booking and retry with a NEW key (the web app makes a new one each
 *    time a dialog opens).
 *
 * Handlers must answer with `res.json(...)` (every endpoint this guards does). Mount it
 * AFTER authenticate / authorize / validateBody: `…, validateBody(Schema), idempotent(), handler`.
 */

export const IDEMPOTENCY_TTL_HOURS = 24;
/** How long a parallel duplicate waits for the first request before giving up with 409. */
const WAIT_MS = 15_000;
const POLL_MS = 100;
/** An IN_PROGRESS claim older than this is treated as abandoned (see above — never taken over). */
const STALE_AFTER_MS = 2 * 60_000;
/** Letters, digits and  - _ . :  — 8 to 128 characters (a UUID fits). */
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

interface KeyRow {
  state: 'IN_PROGRESS' | 'COMPLETED';
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
  age_ms: number;
}

/** JSON with object keys sorted, so `{a,b}` and `{b,a}` hash the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function hashRequest(parts: {
  method: string;
  route: string;
  params: unknown;
  propertyId: string | null;
  body: unknown;
}): string {
  return createHash('sha256').update(stableStringify(parts)).digest('hex');
}

export function isValidIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Expired rows are only ever re-claimed by their own key, so something has to delete the
// rest. Cheap, indexed, and at most once an hour per process — no scheduler wiring needed.
let lastPruneMs = 0;
async function pruneExpired(dbi: Kysely<Database>): Promise<void> {
  const now = Date.now();
  if (now - lastPruneMs < 60 * 60_000) return;
  lastPruneMs = now;
  try {
    await dbi.deleteFrom('idempotency_keys').where(sql<boolean>`expires_at < now()`).execute();
  } catch (err) {
    logger.warn({ err }, '[idempotency] could not prune expired keys');
  }
}

export function idempotent(dbInstance: Kysely<Database> = defaultDb): RequestHandler {
  /** Try to become the request that does the work. True = we own the key now. */
  async function claim(userId: string, endpoint: string, key: string, hash: string): Promise<boolean> {
    // A live row blocks the insert (no row returned). An EXPIRED row is overwritten, i.e.
    // the key is re-claimed from scratch.
    const res = await sql<{ id: string }>`
      INSERT INTO idempotency_keys (user_id, endpoint, key, request_hash)
      VALUES (${userId}, ${endpoint}, ${key}, ${hash})
      ON CONFLICT (user_id, endpoint, key) DO UPDATE
        SET request_hash = EXCLUDED.request_hash,
            state = 'IN_PROGRESS',
            response_status = NULL,
            response_body = NULL,
            created_at = now(),
            completed_at = NULL,
            expires_at = now() + make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})
        WHERE idempotency_keys.expires_at <= now()
      RETURNING id
    `.execute(dbInstance);
    return res.rows.length > 0;
  }

  async function read(userId: string, endpoint: string, key: string): Promise<KeyRow | undefined> {
    const res = await sql<KeyRow>`
      SELECT state, request_hash, response_status, response_body,
             (EXTRACT(EPOCH FROM (now() - created_at)) * 1000)::float8 AS age_ms
        FROM idempotency_keys
       WHERE user_id = ${userId} AND endpoint = ${endpoint} AND key = ${key}
         AND expires_at > now()
    `.execute(dbInstance);
    return res.rows[0];
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.get('Idempotency-Key');
      if (raw === undefined) return next();

      const key = raw.trim();
      if (!isValidIdempotencyKey(key)) {
        throw AppError.badRequest(
          'The Idempotency-Key must be 8 to 128 characters: letters, digits and - _ . :'
        );
      }
      const userId = req.user?.sub;
      if (!userId) throw AppError.unauthorized();

      const route = `${req.baseUrl}${req.route?.path ?? req.path}`;
      const endpoint = `${req.method} ${route}`;
      const hash = hashRequest({
        method: req.method,
        route,
        params: req.params,
        propertyId: req.activePropertyId ?? null,
        body: req.body,
      });
      void pruneExpired(dbInstance);

      const deadline = Date.now() + WAIT_MS;
      for (;;) {
        if (await claim(userId, endpoint, key, hash)) {
          armCapture(req, res, dbInstance, userId, endpoint, key);
          return next();
        }

        const existing = await read(userId, endpoint, key);
        if (!existing) continue; // released or expired between our two statements — try again

        if (existing.request_hash !== hash) {
          throw AppError.unprocessable(
            'This Idempotency-Key was already used for a different request. Use a new key for a new request.'
          );
        }
        if (existing.state === 'COMPLETED') {
          res.setHeader('Idempotent-Replayed', 'true');
          res.status(existing.response_status ?? 200).json(existing.response_body ?? null);
          return;
        }
        // Still running — either a parallel duplicate (wait for it) or an abandoned claim.
        if (existing.age_ms > STALE_AFTER_MS) {
          throw AppError.conflict(
            'An earlier attempt with this Idempotency-Key never reported back, so it may or may not have gone through. Check the booking first, then try again with a new key.'
          );
        }
        if (Date.now() >= deadline) {
          throw AppError.conflict(
            'The first request with this Idempotency-Key is still being processed. Wait a moment and check the result before trying again.'
          );
        }
        await sleep(POLL_MS);
      }
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Hook the response so the claim is settled BEFORE the client sees it: stored on 2xx,
 * released otherwise. (Settling after sending would let a fast retry slip in between.)
 */
function armCapture(
  req: Request,
  res: Response,
  dbi: Kysely<Database>,
  userId: string,
  endpoint: string,
  key: string
): void {
  let settled = false;
  const originalJson = res.json.bind(res);

  res.json = (body?: unknown): Response => {
    if (settled) return originalJson(body);
    settled = true;
    const status = res.statusCode;
    const settle =
      status >= 200 && status < 300
        ? dbi
            .updateTable('idempotency_keys')
            .set({
              state: 'COMPLETED',
              response_status: status,
              // Round-trip through JSON so what we store is exactly what the client received.
              response_body: JSON.stringify(body === undefined ? null : body) as unknown,
              completed_at: sql<Date>`now()`,
            })
            .where('user_id', '=', userId)
            .where('endpoint', '=', endpoint)
            .where('key', '=', key)
            .execute()
        : dbi
            .deleteFrom('idempotency_keys')
            .where('user_id', '=', userId)
            .where('endpoint', '=', endpoint)
            .where('key', '=', key)
            .where('state', '=', 'IN_PROGRESS')
            .execute();
    settle
      .catch((err) => logger.error({ err, requestId: req.id, endpoint }, '[idempotency] could not settle key'))
      .finally(() => originalJson(body));
    return res;
  };

  // A handler that ended the response some other way (res.end / sendStatus) never reached
  // res.json; the work is done, so free the key rather than leave it IN_PROGRESS.
  res.on('finish', () => {
    if (settled) return;
    settled = true;
    dbi
      .deleteFrom('idempotency_keys')
      .where('user_id', '=', userId)
      .where('endpoint', '=', endpoint)
      .where('key', '=', key)
      .where('state', '=', 'IN_PROGRESS')
      .execute()
      .catch((err) => logger.error({ err, endpoint }, '[idempotency] could not release key'));
  });
}
