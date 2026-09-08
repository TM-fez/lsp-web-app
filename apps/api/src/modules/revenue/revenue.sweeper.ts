import type { Kysely } from 'kysely';
import { db as defaultDb } from '../../config/db.js';
import { env } from '../../config/env.js';
import { todayInPropertyTZ } from '../../core/time.js';
import type { Database } from '../../db/types.js';
import { RevenueRepository } from './revenue.repository.js';
import { RevenueService } from './revenue.service.js';
import { addDaysIso } from './revenue.util.js';
import type { RecogniseResult } from './revenue.types.js';

/**
 * G30 — the nightly recognition sweep, as the scheduler runs it.
 *
 * Recognition is the one sweep with nothing urgent about it: a night is earned on a
 * calendar boundary, so running it every 60 seconds like the hold sweep would be
 * pure noise. It self-gates to REVENUE_RECOGNITION_INTERVAL_MS (a day) and returns
 * zeros in between, exactly as retention and channel sync do.
 *
 * ── Why the sweep, and not a hook on every booking mutation ─────────────────────
 *
 * reconcile() compares what a booking SHOULD earn against what it already earns and
 * leaves an agreeing booking untouched, so running it repeatedly is free and safe.
 * The alternative — write on confirm, on re-price, on move, on cancel — needs a hook
 * in every mutation path, and the first hook anybody forgets is a month that silently
 * under-reports. A sweep that reconciles cannot be forgotten.
 *
 * ── The window ──────────────────────────────────────────────────────────────────
 *
 * Bounded to a rolling window around the property day rather than all of history:
 * settled months do not change, and rescanning years of them nightly would cost real
 * time for a guaranteed no-op. The bounds are generous on purpose — a booking taken a
 * year ahead is ordinary here — and both are configurable, because the right answer
 * depends on how far ahead the house actually sells.
 *
 * Note the deliberate asymmetry: findNoLongerEarning() inside reconcile() is NOT
 * windowed. Recognising nights is bounded, but WITHDRAWING them is not — a stay
 * cancelled long after the fact must stop earning whenever that happens, and there is
 * no window in which it is acceptable to keep billing a guest who cancelled.
 *
 * The gate is per-process, so a restart means one extra pass — the same trade
 * retention already accepts. It is also per-process across INSTANCES, which today is
 * moot (Render runs one) and harmless if it ever is not: two concurrent reconciles
 * cannot double-count, because `revenue_recognition_live_night` lets only one of them
 * commit and the loser fails its transaction and is retried on the next tick. That is
 * a safe failure, unlike the silent double-count an append-only design would give. It matters slightly more here because the free Render
 * service sleeps and wakes repeatedly (see DEPLOY.md), so on that plan "daily" is in
 * practice "on most wakes". Harmless, because reconcile() leaves an agreeing booking
 * untouched; it costs one windowed scan, not a restatement.
 *
 * ── No pricer, deliberately ─────────────────────────────────────────────────────
 *
 * The sweep recognises only totals that were AGREED and frozen. Both confirmation
 * paths freeze `folio_total_amount`, so ordinary bookings arrive priced. Wiring live
 * pricing in here would reconstruct unfrozen bookings at today's rates every night,
 * restating them each time a rate moved — churn in a ledger whose whole point is that
 * it does not silently restate. Reconstruction is the backfill's job: run once,
 * announced, and flagged PRICED wherever the figures surface.
 */

export const NO_RECOGNITION: RecogniseResult = {
  reservations_examined: 0,
  reservations_changed: 0,
  nights_written: 0,
  nights_superseded: 0,
  reconstructed: 0,
  unpriced: 0,
};

export type RevenueSweeper = () => Promise<RecogniseResult>;

export function createRevenueSweeper(
  dbInstance: Kysely<Database> = defaultDb,
  intervalMs: number = env.REVENUE_RECOGNITION_INTERVAL_MS,
  service: RevenueService = new RevenueService(new RevenueRepository(dbInstance))
): RevenueSweeper {
  let lastRunMs = 0;

  return async () => {
    const nowMs = Date.now();
    if (nowMs - lastRunMs < intervalMs) return NO_RECOGNITION;
    // Stamped BEFORE the await, not after: the scheduler's setInterval fires every 60s
    // regardless of how long a tick takes, so stamping afterwards would let a slow
    // reconcile overlap itself.
    lastRunMs = nowMs;

    // The property day, not the server's (invariant 2). The window is a range of
    // CALENDAR dates, so it is built from the Gaborone day and never from a timestamp.
    const today = todayInPropertyTZ();

    return service.reconcile({
      from: addDaysIso(today, -env.REVENUE_LOOKBACK_DAYS),
      toExcl: addDaysIso(today, env.REVENUE_LOOKAHEAD_DAYS),
    });
  };
}
