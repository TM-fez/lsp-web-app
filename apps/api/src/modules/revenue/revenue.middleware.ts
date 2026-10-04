import type { Request, Response, NextFunction } from 'express';
import type { Kysely } from 'kysely';
import { db as defaultDb } from '../../config/db.js';
import { logger } from '../../core/logger.js';
import type { Database } from '../../db/types.js';
import { RevenueRepository } from './revenue.repository.js';
import { RevenueService } from './revenue.service.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_IDS = 50;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * (Round 4, N-11) Put a booking's nights on the revenue ledger as soon as the request
 * that changed it succeeds, instead of "at the next daily sweep".
 *
 * Mounted in front of every router that can create, confirm, re-price, move or cancel a
 * booking. After a SUCCESSFUL write it reconciles the bookings the request touched — any
 * id in the URL, the body or the reply that is (or leads to) a booking — and only then
 * lets the reply go, so a report read straight after a booking already includes it.
 *
 * Why here and not inside each reservation mutation: the ledger is a separate module that
 * must never be able to break a booking (invariant 7), and a hook per mutation is the one
 * somebody forgets. So this is best-effort AFTER the money action commits: a failure is
 * logged and the booking is untouched. The scheduled sweep stays as the safety net for
 * anything that slips through (bookings made by the scheduler, a crash between the two).
 * Reconcile leaves an agreeing booking alone, so doing it twice is free.
 */
export function recogniseRevenueAfterWrite(dbInstance: Kysely<Database> = defaultDb) {
  const service = new RevenueService(new RevenueRepository(dbInstance));

  return (req: Request, res: Response, next: NextFunction) => {
    if (!WRITES.has(req.method)) return next();

    const send = res.send.bind(res);
    let handled = false;
    res.send = (body?: unknown) => {
      if (handled || res.statusCode >= 300) return send(body as never);
      handled = true;

      const seen = new Set<string>();
      for (const text of [req.originalUrl, safeJson(req.body), typeof body === 'string' ? body : safeJson(body)]) {
        for (const id of text.match(UUID) ?? []) seen.add(id.toLowerCase());
        if (seen.size >= MAX_IDS) break;
      }

      const userId = req.user?.sub ?? null;
      service
        .reconcileFor([...seen].slice(0, MAX_IDS), { userId })
        .catch((err: unknown) => logger.error({ err }, '[revenue] immediate recognition failed; the sweep will retry'))
        .finally(() => send(body as never));
      return res;
    };
    next();
  };
}

function safeJson(value: unknown): string {
  try {
    return value === undefined ? '' : JSON.stringify(value);
  } catch {
    return '';
  }
}
