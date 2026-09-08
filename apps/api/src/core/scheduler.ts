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
import { createWebsiteBookingExpiry } from '../modules/reservations/reservations.expiry.js';
import { createRemindersSweeper, NO_REMINDERS, type ReminderResult } from '../modules/notifications/reminders.js';
import { ChannelRepository } from '../modules/channel/channel.repository.js';
import {
  createChannelSyncSweeper,
  NO_IMPORT,
  type ImportSummary,
} from '../modules/channel/channel.import.service.js';
import {
  createRevenueSweeper,
  NO_RECOGNITION,
  type RevenueSweeper,
} from '../modules/revenue/revenue.sweeper.js';
import { createRetentionSweeper, type RetentionResult } from './retention.js';
import { logger } from './logger.js';

/**
 * Background auto-expiry sweep.
 *
 * A hold (30-min TTL) and a quote (24-h TTL) each carry an expiry timestamp, but
 * nothing advanced them past it on its own — `releaseExpired()` / `expireStaleQuotes()`
 * only ran when an operator hit the manual sweep endpoint. This runner calls both on
 * a fixed interval so a guest who abandons a booking frees the room, and a stale price
 * quote stops being usable, without anyone lifting a finger.
 *
 * The third sweep closes the hold-less public path: a /stay booking is a PENDING
 * reservation that blocks its nights outright, so an abandoned one is auto-cancelled
 * after WEBSITE_PENDING_TTL_HOURS (see reservations.expiry.ts).
 *
 * (G30) Accrual revenue recognition rides here as well, self-gated to a day. It is the
 * one sweep with nothing urgent about it — a night is earned on a calendar boundary —
 * and it RECONCILES rather than appends, so an agreeing booking costs nothing and a
 * missed tick corrects itself on the next one. That is the whole reason recognition is
 * a sweep and not a hook on every booking mutation: a hook somebody forgets is a month
 * that silently under-reports.
 *
 * (H4) The Booking.com import poll rides here too, self-gated to CHANNEL_SYNC_INTERVAL_MS
 * — the paid always-on plan made an external 15-min cron unnecessary. It is the one sweep
 * that reaches the network, so it is also the one that can be slow; Promise.allSettled
 * keeps a hanging OTA feed from holding up the rest, and each fetch has its own 15s
 * timeout inside the importer.
 */

export interface HoldsSweeper {
  releaseExpired(): Promise<number>;
}
export interface QuotesSweeper {
  expireStaleQuotes(): Promise<number>;
}
export type WebsiteBookingsSweeper = () => Promise<number>;
export type RetentionSweeper = () => Promise<RetentionResult>;
export type RemindersSweeper = () => Promise<ReminderResult>;
export type ChannelSyncSweeper = () => Promise<ImportSummary>;

export interface SweepResult {
  holdsReleased: number;
  quotesExpired: number;
  websiteBookingsExpired: number;
  refreshTokensPruned: number;
  auditLogsPruned: number;
  remindersRaised: number;
  /** OTA blocks written/revived this tick, and collisions the importer could not apply. */
  channelBlocksUpserted: number;
  channelCollisions: number;
  /** Accrual ledger: nights recognised and nights withdrawn this tick (G30). */
  revenueNightsWritten: number;
  revenueNightsSuperseded: number;
  /**
   * Earning bookings with no agreed total, so nothing to recognise. The line worth
   * watching: a persistently non-zero count means real stays are missing from the
   * accrual revenue figures and are waiting on the backfill.
   */
  revenueUnpriced: number;
}

const NO_RETENTION: RetentionResult = { refreshTokensPruned: 0, auditLogsPruned: 0 };

/**
 * Run all sweeps once. They are independent: one failing (e.g. a transient DB error)
 * must not cancel the others, so we settle all and surface counts for whatever succeeded.
 */
export async function runSweep(
  holds: HoldsSweeper,
  quotes: QuotesSweeper,
  websiteBookings: WebsiteBookingsSweeper = async () => 0,
  retention: RetentionSweeper = async () => NO_RETENTION,
  reminders: RemindersSweeper = async () => NO_REMINDERS,
  channelSync: ChannelSyncSweeper = async () => NO_IMPORT,
  revenue: RevenueSweeper = async () => NO_RECOGNITION,
): Promise<SweepResult> {
  const [held, quoted, website, retained, reminded, synced, recognised] = await Promise.allSettled([
    holds.releaseExpired(),
    quotes.expireStaleQuotes(),
    websiteBookings(),
    retention(),
    reminders(),
    channelSync(),
    revenue(),
  ]);

  if (held.status === 'rejected') logger.error({ err: held.reason }, '[scheduler] hold sweep failed');
  if (quoted.status === 'rejected') logger.error({ err: quoted.reason }, '[scheduler] quote sweep failed');
  if (website.status === 'rejected')
    logger.error({ err: website.reason }, '[scheduler] website-booking sweep failed');
  if (retained.status === 'rejected')
    logger.error({ err: retained.reason }, '[scheduler] retention sweep failed');
  if (reminded.status === 'rejected')
    logger.error({ err: reminded.reason }, '[scheduler] reminders sweep failed');
  if (synced.status === 'rejected')
    logger.error({ err: synced.reason }, '[scheduler] channel sync failed');
  if (recognised.status === 'rejected')
    logger.error({ err: recognised.reason }, '[scheduler] revenue recognition failed');

  const retentionCounts = retained.status === 'fulfilled' ? retained.value : NO_RETENTION;
  const reminderCounts = reminded.status === 'fulfilled' ? reminded.value : NO_REMINDERS;
  const syncCounts = synced.status === 'fulfilled' ? synced.value : NO_IMPORT;
  const revenueCounts = recognised.status === 'fulfilled' ? recognised.value : NO_RECOGNITION;

  return {
    holdsReleased: held.status === 'fulfilled' ? held.value : 0,
    quotesExpired: quoted.status === 'fulfilled' ? quoted.value : 0,
    websiteBookingsExpired: website.status === 'fulfilled' ? website.value : 0,
    refreshTokensPruned: retentionCounts.refreshTokensPruned,
    auditLogsPruned: retentionCounts.auditLogsPruned,
    remindersRaised:
      reminderCounts.checkoutDue + reminderCounts.maintenanceStale + reminderCounts.maintenanceUnassigned,
    channelBlocksUpserted: syncCounts.upserted,
    channelCollisions: syncCounts.collisions,
    revenueNightsWritten: revenueCounts.nights_written,
    revenueNightsSuperseded: revenueCounts.nights_superseded,
    revenueUnpriced: revenueCounts.unpriced,
  };
}

/** Build a sweep closure bound to the real services — same wiring the holds router uses. */
export function createSweeper(dbInstance: Kysely<Database> = db): () => Promise<SweepResult> {
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const quotes = new QuotesService(new QuotesRepository(dbInstance), pricing);
  const holds = new HoldsService(new HoldsRepository(dbInstance), quotes);
  const websiteBookings = createWebsiteBookingExpiry(dbInstance);
  const retention = createRetentionSweeper(dbInstance); // self-gates to once per day
  const reminders = createRemindersSweeper(dbInstance); // self-gates to once per day
  // Self-gates to CHANNEL_SYNC_INTERVAL_MS (15 min), not the 60s tick. A no-op until a
  // unit has a booking_ical_url — listImportRooms() returns nothing before then, so this
  // is safe to run from the day it deploys, ahead of the extranet paste-in.
  const channelSync = createChannelSyncSweeper(
    new ChannelRepository(dbInstance),
    env.CHANNEL_SYNC_INTERVAL_MS,
  );
  // Self-gates to REVENUE_RECOGNITION_INTERVAL_MS (a day), not the 60s tick. Safe from
  // the day it deploys: reconcile() leaves an agreeing booking untouched, and with no
  // pricer wired it only ever recognises totals that were actually agreed.
  const revenue = createRevenueSweeper(dbInstance);
  return () => runSweep(holds, quotes, websiteBookings, retention, reminders, channelSync, revenue);
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
      .then(({
        holdsReleased,
        quotesExpired,
        websiteBookingsExpired,
        refreshTokensPruned,
        auditLogsPruned,
        remindersRaised,
        channelBlocksUpserted,
        channelCollisions,
        revenueNightsWritten,
        revenueNightsSuperseded,
        revenueUnpriced,
      }) => {
        if (holdsReleased > 0 || quotesExpired > 0 || websiteBookingsExpired > 0) {
          logger.info(
            { holdsReleased, quotesExpired, websiteBookingsExpired },
            '[scheduler] sweep expired stale items',
          );
        }
        if (refreshTokensPruned > 0 || auditLogsPruned > 0) {
          logger.info(
            { refreshTokensPruned, auditLogsPruned },
            '[scheduler] retention pruned rows',
          );
        }
        if (remindersRaised > 0) {
          logger.info({ remindersRaised }, '[scheduler] reminder notifications raised');
        }
        // Collisions are the line worth watching after go-live: a non-zero count means an
        // OTA night could not be written because it overlapped a stay LSP already held.
        // The importer has already emailed CHANNEL_ALERT_EMAIL — this is the log trail.
        if (channelBlocksUpserted > 0 || channelCollisions > 0) {
          logger.info(
            { channelBlocksUpserted, channelCollisions },
            '[scheduler] channel sync reconciled OTA blocks',
          );
        }
        if (revenueNightsWritten > 0 || revenueNightsSuperseded > 0) {
          logger.info(
            { revenueNightsWritten, revenueNightsSuperseded },
            '[scheduler] revenue recognition reconciled the accrual ledger',
          );
        }
        // Warn, not info: these are confirmed stays earning nothing, so the accrual
        // revenue figures are understated by however much they were worth.
        if (revenueUnpriced > 0) {
          logger.warn(
            { revenueUnpriced },
            '[scheduler] bookings with no agreed total earned nothing — awaiting the G30 backfill',
          );
        }
      })
      .catch((err) => logger.error({ err }, '[scheduler] sweep failed'));
  };

  timer = setInterval(tick, intervalMs);
  timer.unref(); // the sweep must never keep the process alive on its own
  logger.info({ intervalMs }, '[scheduler] auto-expiry sweep running');
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
