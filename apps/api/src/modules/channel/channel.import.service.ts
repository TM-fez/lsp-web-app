import { ChannelRepository } from './channel.repository.js';
import { parseIcs, type ParsedEvent } from './channel.ical-parse.js';
import { dispatchCollisionAlert, type CollisionAlert, type AlertResult } from './channel.alerts.js';
import { logger } from '../../core/logger.js';

// Re-page the manager for the SAME OTA event at most once per this window. A genuinely new
// collision (a different UID, or this same one again after the window lapses) still alerts.
// The dashboard audit row is the ledger — see ChannelRepository.recentCollisionAlertExists.
const COLLISION_ALERT_THROTTLE_HOURS = 6;

// Mass-cancel guard: a poll may only end this share of a unit's active blocks (and at
// least this many) before we assume the FEED is broken rather than the calendar empty —
// a truncated/empty 200 from Booking.com must not reopen every night for direct sale.
const PRUNE_GUARD_MIN = 3;
const PRUNE_GUARD_FRACTION = 0.5;

// Postgres exclusion_violation. The reservations_no_overlap EXCLUDE constraint raises this
// when an imported OTA night overlaps an existing blocking stay — our collision signal.
function isNoOverlapViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23P01';
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Tier 0 of the OTA contact-info plan: an iCal feed will never carry a phone or email,
// but whatever it DOES say about the night (summary; Airbnb adds a reservation URL and
// phone-last-4 in the description) is kept on the block instead of thrown away.
export function feedNotes(ev: Pick<ParsedEvent, 'summary' | 'description'>): string | null {
  const parts = [ev.summary, ev.description].filter(
    (s): s is string => Boolean(s && s.trim().length > 0),
  );
  if (parts.length === 0) return null;
  return `OTA feed: ${parts.join(' — ')}`.slice(0, 1000);
}

// Default fetcher: Node 20 global fetch with a hard timeout so one slow OTA feed can't
// stall the whole poll. Injectable so tests never touch the network.
async function defaultFetchIcs(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'LSP-ChannelSync/1.0', accept: 'text/calendar' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export interface RoomImportResult {
  roomId: string;
  code: string;
  upserted: number; // OTA blocks inserted or updated (incl. claimed-date moves)
  unchanged: number; // events already reflected — no write issued
  cancelled: number; // blocks ended (event cancelled, or vanished from the feed)
  collisions: number; // OTA nights that clashed with a direct sale (detected)
  alertsSuppressed: number; // collisions NOT paged — same UID already alerted within the window
  pruneSkipped: boolean; // the empty-feed / mass-cancel guard held the prune back
  warnings: number; // non-fatal anomalies (e.g. OTA-vs-OTA overlap, guarded prune)
  error: string | null; // fetch/parse failure for the whole unit
}

export interface ImportSummary {
  ran: boolean; // false when another import already held the lock
  roomsProcessed: number;
  upserted: number;
  unchanged: number;
  cancelled: number;
  collisions: number;
  alertsSuppressed: number;
  warnings: number;
  rooms: RoomImportResult[];
}

export interface ImportDeps {
  fetchIcs?: (url: string) => Promise<string>;
  dispatchAlert?: (alert: CollisionAlert) => Promise<AlertResult[]>;
}

// Claimed = a real guest contact was attached (Tier 1 claim flow) and the booking moved
// into the normal reservation lifecycle. The feed still governs its dates, but never its
// status, its contact, or its notes.
const CLAIMED_ACTIVE = new Set(['CONFIRMED', 'CHECKED_IN']);

export class ChannelImportService {
  private readonly fetchIcs: (url: string) => Promise<string>;
  private readonly dispatchAlert: (alert: CollisionAlert) => Promise<AlertResult[]>;

  constructor(private readonly repo: ChannelRepository, deps: ImportDeps = {}) {
    this.fetchIcs = deps.fetchIcs ?? defaultFetchIcs;
    this.dispatchAlert = deps.dispatchAlert ?? dispatchCollisionAlert;
  }

  // Pull every unit that has a Booking.com feed configured and reconcile it into LSP.
  // Cluster-wide advisory lock: overlapping runs (cron tick + manual trigger) would race
  // on the same UIDs, so a second caller simply reports ran:false and does nothing.
  async runImport(): Promise<ImportSummary> {
    const empty: ImportSummary = {
      ran: false,
      roomsProcessed: 0,
      upserted: 0,
      unchanged: 0,
      cancelled: 0,
      collisions: 0,
      alertsSuppressed: 0,
      warnings: 0,
      rooms: [],
    };

    if (!(await this.repo.tryAdvisoryLock())) {
      logger.warn('[channel-sync] import already running elsewhere — skipping this trigger');
      return empty;
    }

    try {
      const rooms = await this.repo.listImportRooms();
      const results: RoomImportResult[] = [];
      for (const r of rooms) {
        if (!r.booking_ical_url) continue;
        results.push(await this.importRoom({ id: r.id, code: r.code, url: r.booking_ical_url }));
      }
      return {
        ran: true,
        roomsProcessed: results.length,
        upserted: results.reduce((n, r) => n + r.upserted, 0),
        unchanged: results.reduce((n, r) => n + r.unchanged, 0),
        cancelled: results.reduce((n, r) => n + r.cancelled, 0),
        collisions: results.reduce((n, r) => n + r.collisions, 0),
        alertsSuppressed: results.reduce((n, r) => n + r.alertsSuppressed, 0),
        warnings: results.reduce((n, r) => n + r.warnings, 0),
        rooms: results,
      };
    } finally {
      await this.repo.releaseAdvisoryLock().catch(() => {});
    }
  }

  // Reconcile one unit's Booking.com feed:
  //   • each live event      → upsert a BLOCKED block (keyed by external_uid); a CLAIMED
  //     booking only follows the feed's dates — status/contact/notes are staff-owned
  //   • a CANCELLED event    → end the block (never a checked-in/out stay)
  //   • an event that overlaps a DIRECT sale → the DB rejects it (23P01); we alert
  //     instead of silently failing, and keep the direct booking
  //   • a block whose event vanished from the feed → end it (the OTA freed the night) —
  //     UNLESS the guard says the feed itself looks broken (empty/truncated response)
  async importRoom(room: { id: string; code: string; url: string }): Promise<RoomImportResult> {
    const res: RoomImportResult = {
      roomId: room.id,
      code: room.code,
      upserted: 0,
      unchanged: 0,
      cancelled: 0,
      collisions: 0,
      alertsSuppressed: 0,
      pruneSkipped: false,
      warnings: 0,
      error: null,
    };

    let text: string;
    try {
      text = await this.fetchIcs(room.url);
    } catch (err) {
      res.error = `fetch failed: ${msg(err)}`;
      return res;
    }

    let events;
    try {
      events = parseIcs(text);
    } catch (err) {
      res.error = `parse failed: ${msg(err)}`;
      return res;
    }

    const seen = new Set<string>();

    for (const ev of events) {
      if (!ev.uid) continue;

      if (ev.cancelled) {
        const existing = await this.repo.findBlockByUid(ev.uid);
        if (!existing || existing.deleted_at) continue;
        if (existing.status === 'BLOCKED' || existing.status === 'CONFIRMED') {
          // A claimed-but-not-arrived guest cancelling on Booking.com frees the night
          // here too; staff see the reservation flip to CANCELLED in the list.
          await this.repo.cancelBlock(existing.id);
          res.cancelled++;
        } else if (CLAIMED_ACTIVE.has(existing.status) || existing.status === 'CHECKED_OUT') {
          // Never auto-cancel someone who is (or was) physically in the room.
          logger.warn(
            { unit: room.code, uid: ev.uid, status: existing.status },
            '[channel-sync] OTA cancelled an in-house/checked-out stay — left untouched, review manually',
          );
          res.warnings++;
        }
        continue;
      }

      seen.add(ev.uid);
      try {
        const existing = await this.repo.findBlockByUid(ev.uid);
        if (existing && CLAIMED_ACTIVE.has(existing.status)) {
          const wrote = await this.repo.updateClaimedDates(existing.id, {
            checkIn: ev.start,
            checkOut: ev.endExclusive,
          });
          wrote ? res.upserted++ : res.unchanged++;
        } else if (existing && existing.status === 'CHECKED_OUT') {
          // The stay already ended in LSP; nothing for the feed to govern anymore.
          res.unchanged++;
        } else if (existing) {
          const wrote = await this.repo.updateBlock(existing.id, {
            roomId: room.id,
            checkIn: ev.start,
            checkOut: ev.endExclusive,
            notes: feedNotes(ev),
          });
          wrote ? res.upserted++ : res.unchanged++;
        } else {
          await this.repo.insertImportedBlock({
            roomId: room.id,
            externalUid: ev.uid,
            checkIn: ev.start,
            checkOut: ev.endExclusive,
            notes: feedNotes(ev),
          });
          res.upserted++;
        }
      } catch (err) {
        if (isNoOverlapViolation(err)) {
          const conflicts = await this.repo.findConflicts(room.id, ev.start, ev.endExclusive);
          if (conflicts.length > 0) {
            res.collisions++;
            // Throttle: if this same OTA event was already paged within the window, record
            // it but stay quiet. A new UID (or this one after the window) still alerts.
            if (await this.repo.recentCollisionAlertExists(ev.uid, COLLISION_ALERT_THROTTLE_HOURS)) {
              res.alertsSuppressed++;
            } else {
              await this.dispatchAlert({
                unitCode: room.code,
                roomId: room.id,
                otaUid: ev.uid,
                otaCheckIn: ev.start,
                otaCheckOut: ev.endExclusive,
                conflicts: conflicts.map((c) => ({
                  reservationId: c.id,
                  status: c.status,
                  source: c.source,
                  guestName: c.guest_name,
                  checkIn: c.check_in_date,
                  checkOut: c.check_out_date,
                })),
              });
            }
          } else {
            // 23P01 but nothing direct conflicts → an OTA-vs-OTA overlap or feed anomaly.
            // Not a guest double-booking, so don't page the manager.
            logger.warn(
              { unit: room.code, uid: ev.uid },
              '[channel-sync] overlap with no direct conflict',
            );
            res.warnings++;
          }
        } else {
          logger.error(
            { unit: room.code, uid: ev.uid, err: msg(err) },
            '[channel-sync] block upsert failed',
          );
          res.warnings++;
        }
      }
    }

    // Prune: any block still active in LSP whose event is no longer in the feed has been
    // freed on Booking.com — end it so the night reopens for direct sale. Guarded: a feed
    // that suddenly says "nothing at all" (or would end most of the calendar in one poll)
    // is far more likely broken than truly empty, and reopening those nights invites a
    // real double-booking. Skip the prune, warn, and let a healthy later poll reconcile.
    const active = await this.repo.listActiveOtaRows(room.id);
    const activeBlocked = active.filter((r) => r.status === 'BLOCKED');
    const vanishedBlocked = activeBlocked.filter((r) => !seen.has(r.external_uid));
    const vanishedClaimed = active.filter(
      (r) => r.status !== 'BLOCKED' && !seen.has(r.external_uid),
    );

    // Claimed bookings are staff-owned — never auto-cancelled by absence, only surfaced.
    for (const row of vanishedClaimed) {
      logger.warn(
        { unit: room.code, uid: row.external_uid, status: row.status },
        '[channel-sync] claimed OTA booking vanished from the feed — review manually',
      );
      res.warnings++;
    }

    const feedLooksBroken =
      (events.length === 0 && activeBlocked.length > 0) ||
      (vanishedBlocked.length >= PRUNE_GUARD_MIN &&
        vanishedBlocked.length > activeBlocked.length * PRUNE_GUARD_FRACTION);

    if (feedLooksBroken) {
      res.pruneSkipped = true;
      res.warnings++;
      logger.warn(
        { unit: room.code, events: events.length, active: activeBlocked.length, vanished: vanishedBlocked.length },
        '[channel-sync] prune guard tripped — feed looks broken/truncated, keeping existing blocks',
      );
      return res;
    }

    for (const row of vanishedBlocked) {
      const existing = await this.repo.findBlockByUid(row.external_uid);
      if (existing) {
        await this.repo.cancelBlock(existing.id);
        res.cancelled++;
      }
    }

    return res;
  }
}

/** An import that did not run because the sweeper's interval had not yet elapsed. */
export const NO_IMPORT: ImportSummary = {
  ran: false,
  roomsProcessed: 0,
  upserted: 0,
  unchanged: 0,
  cancelled: 0,
  collisions: 0,
  alertsSuppressed: 0,
  warnings: 0,
  rooms: [],
};

/**
 * (H4 go-live) Channel sync as an in-process sweep instead of an external cron.
 *
 * The original plan was a platform trigger hitting /cron/channel-sync every 15 min,
 * because the free Render service slept and could not be trusted to hold a timer.
 * On the paid always-on plan that constraint is gone, so the poll rides the scheduler
 * the other five sweeps already use — no extra service, no CRON_SECRET on the happy
 * path. `/cron/channel-sync` stays mounted as the manual/fallback trigger (and for a
 * serverless host), exactly like /cron/sweep and /cron/reminders.
 *
 * Self-gates to intervalMs because the sweep tick is 60s and an OTA fetch must not run
 * that hot. Same closure pattern as createRemindersSweeper. Gating is per process: a
 * restart re-polls immediately, which is harmless — the import is an idempotent
 * reconcile keyed on (source, external_uid).
 */
export function createChannelSyncSweeper(
  repo: ChannelRepository,
  intervalMs: number = 15 * 60_000,
  deps: ImportDeps = {},
): () => Promise<ImportSummary> {
  const service = new ChannelImportService(repo, deps);
  let lastRunMs = 0;

  return async () => {
    const nowMs = Date.now();
    if (nowMs - lastRunMs < intervalMs) return NO_IMPORT;
    lastRunMs = nowMs;
    return service.runImport();
  };
}
