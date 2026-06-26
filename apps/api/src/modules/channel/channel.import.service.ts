import { ChannelRepository } from './channel.repository.js';
import { parseIcs } from './channel.ical-parse.js';
import { dispatchCollisionAlert, type CollisionAlert, type AlertResult } from './channel.alerts.js';

// Re-page the manager for the SAME OTA event at most once per this window. A genuinely new
// collision (a different UID, or this same one again after the window lapses) still alerts.
// The dashboard audit row is the ledger — see ChannelRepository.recentCollisionAlertExists.
const COLLISION_ALERT_THROTTLE_HOURS = 6;

// Postgres exclusion_violation. The reservations_no_overlap EXCLUDE constraint raises this
// when an imported OTA night overlaps an existing blocking stay — our collision signal.
function isNoOverlapViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23P01';
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  upserted: number; // OTA blocks inserted or updated
  cancelled: number; // blocks ended (event cancelled, or vanished from the feed)
  collisions: number; // OTA nights that clashed with a direct sale (detected)
  alertsSuppressed: number; // collisions NOT paged — same UID already alerted within the window
  warnings: number; // non-fatal anomalies (e.g. OTA-vs-OTA overlap, unexpected error)
  error: string | null; // fetch/parse failure for the whole unit
}

export interface ImportSummary {
  roomsProcessed: number;
  upserted: number;
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

export class ChannelImportService {
  private readonly fetchIcs: (url: string) => Promise<string>;
  private readonly dispatchAlert: (alert: CollisionAlert) => Promise<AlertResult[]>;

  constructor(private readonly repo: ChannelRepository, deps: ImportDeps = {}) {
    this.fetchIcs = deps.fetchIcs ?? defaultFetchIcs;
    this.dispatchAlert = deps.dispatchAlert ?? dispatchCollisionAlert;
  }

  // Pull every unit that has a Booking.com feed configured and reconcile it into LSP.
  async runImport(): Promise<ImportSummary> {
    const rooms = await this.repo.listImportRooms();
    const results: RoomImportResult[] = [];
    for (const r of rooms) {
      if (!r.booking_ical_url) continue;
      results.push(await this.importRoom({ id: r.id, code: r.code, url: r.booking_ical_url }));
    }
    return {
      roomsProcessed: results.length,
      upserted: results.reduce((n, r) => n + r.upserted, 0),
      cancelled: results.reduce((n, r) => n + r.cancelled, 0),
      collisions: results.reduce((n, r) => n + r.collisions, 0),
      alertsSuppressed: results.reduce((n, r) => n + r.alertsSuppressed, 0),
      warnings: results.reduce((n, r) => n + r.warnings, 0),
      rooms: results,
    };
  }

  // Reconcile one unit's Booking.com feed:
  //   • each live event   → upsert a BLOCKED block (keyed by external_uid)
  //   • a CANCELLED event → end that block
  //   • an event that overlaps a DIRECT sale → the DB rejects it (23P01); we alert instead
  //     of silently failing, and keep the direct booking
  //   • a block whose event vanished from the feed → end it (the OTA freed the night)
  async importRoom(room: { id: string; code: string; url: string }): Promise<RoomImportResult> {
    const res: RoomImportResult = {
      roomId: room.id,
      code: room.code,
      upserted: 0,
      cancelled: 0,
      collisions: 0,
      alertsSuppressed: 0,
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
        if (existing && existing.status === 'BLOCKED' && !existing.deleted_at) {
          await this.repo.cancelBlock(existing.id);
          res.cancelled++;
        }
        continue;
      }

      seen.add(ev.uid);
      try {
        const existing = await this.repo.findBlockByUid(ev.uid);
        if (existing) {
          await this.repo.updateBlock(existing.id, { roomId: room.id, checkIn: ev.start, checkOut: ev.endExclusive });
        } else {
          await this.repo.insertImportedBlock({ roomId: room.id, externalUid: ev.uid, checkIn: ev.start, checkOut: ev.endExclusive });
        }
        res.upserted++;
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
            console.warn(`[channel-sync] overlap with no direct conflict on ${room.code} uid=${ev.uid}`);
            res.warnings++;
          }
        } else {
          console.error(`[channel-sync] block upsert failed on ${room.code} uid=${ev.uid}:`, msg(err));
          res.warnings++;
        }
      }
    }

    // Prune: any block still active in LSP whose event is no longer in the feed has been
    // freed on Booking.com — end it so the night reopens for direct sale.
    const active = await this.repo.listActiveBlockUids(room.id);
    for (const uid of active) {
      if (seen.has(uid)) continue;
      const existing = await this.repo.findBlockByUid(uid);
      if (existing) {
        await this.repo.cancelBlock(existing.id);
        res.cancelled++;
      }
    }

    return res;
  }
}
