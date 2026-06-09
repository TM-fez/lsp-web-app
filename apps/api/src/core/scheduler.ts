import type { Kysely } from 'kysely';
import { db } from '../config/db.js';
import { env } from '../config/env.js';
import type { Database } from '../db/types.js';
import { HoldsRepository } from '../modules/holds/holds.repository.js';
import { HoldsService } from '../modules/holds/holds.service.js';
import { QuotesRepository } from '../modules/quotes/quotes.repository.js';
import { QuotesService } from '../modules/quotes/quotes.service.js';
import { PricingRepository } from '../modules/pricing/pricing.repository.js';
import { PricingService } from '../modules/pricing/pricing.service.js';

/**
 * Background auto-expiry sweep.
 *
 * A hold (30-min TTL) and a quote (24-h TTL) each carry an expiry timestamp, but
 * nothing advanced them past it on its own — `releaseExpired()` / `expireStaleQuotes()`
 * only ran when an operator hit the manual sweep endpoint. This runner calls both on
 * a fixed interval so a guest who abandons a booking frees the room, and a stale price
 * quote stops being usable, without anyone lifting a finger.
 *
 * It adds no new logic and no new tables — it only invokes the existing services on a
 * timer, exactly as the manual endpoint does.
 */

export interface HoldsSweeper {
  releaseExpired(): Promise<number>;
}
export interface QuotesSweeper {
  expireStaleQuotes(): Promise<number>;
}

export interface SweepResult {
  holdsReleased: number;
  quotesExpired: number;
}

/**
 * Run both sweeps once. They are independent: one failing (e.g. a transient DB error)
 * must not cancel the other, so we settle both and surface counts for whatever succeeded.
 */
export async function runSweep(holds: HoldsSweeper, quotes: QuotesSweeper): Promise<SweepResult> {
  const [held, quoted] = await Promise.allSettled([
    holds.releaseExpired(),
    quotes.expireStaleQuotes(),
  ]);

  if (held.status === 'rejected') console.error('[scheduler] hold sweep failed:', held.reason);
  if (quoted.status === 'rejected') console.error('[scheduler] quote sweep failed:', quoted.reason);

  return {
    holdsReleased: held.status === 'fulfilled' ? held.value : 0,
    quotesExpired: quoted.status === 'fulfilled' ? quoted.value : 0,
  };
}

/** Build a sweep closure bound to the real services — same wiring the holds router uses. */
export function createSweeper(dbInstance: Kysely<Database> = db): () => Promise<SweepResult> {
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const quotes = new QuotesService(new QuotesRepository(dbInstance), pricing);
  const holds = new HoldsService(new HoldsRepository(dbInstance), quotes);
  return () => runSweep(holds, quotes);
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the recurring sweep. Returns false (and does nothing) when disabled:
 *  - never under tests/e2e (NODE_ENV=test), so suites stay deterministic;
 *  - opt-out for any deployment via DISABLE_SCHEDULER=1.
 * Idempotent: calling it twice keeps a single timer.
 */
export function startScheduler(opts: { intervalMs?: number; dbInstance?: Kysely<Database> } = {}): boolean {
  if (env.NODE_ENV === 'test') return false;
  if (env.DISABLE_SCHEDULER) return false;
  if (timer) return true;

  const intervalMs = opts.intervalMs ?? env.SCHEDULER_INTERVAL_MS;
  const sweep = createSweeper(opts.dbInstance);

  const tick = () => {
    sweep()
      .then(({ holdsReleased, quotesExpired }) => {
        if (holdsReleased > 0 || quotesExpired > 0) {
          console.log(`[scheduler] swept ${holdsReleased} expired hold(s), ${quotesExpired} stale quote(s)`);
        }
      })
      .catch((err) => console.error('[scheduler] sweep failed:', err));
  };

  timer = setInterval(tick, intervalMs);
  timer.unref(); // the sweep must never keep the process alive on its own
  console.log(`[scheduler] auto-expiry sweep running every ${Math.round(intervalMs / 1000)}s`);
  tick(); // clear any backlog that built up while the server was down
  return true;
}

/** Stop the recurring sweep (clean shutdown / test teardown). */
export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
