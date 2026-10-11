import { Kysely, sql } from 'kysely';
import type { Database, RoomRow, ReservationRow } from '../../db/types.js';
import { propertyToday } from '../../core/time.js';
import {
  EXPORTABLE_STATUSES,
  NON_EXPORT_SOURCES,
  IMPORT_SOURCE,
  IMPORT_STATUS,
  SYSTEM_USER_ID,
  SYSTEM_OTA_CONTACT_ID,
} from './channel.types.js';
import { ReservationsRepository } from '../reservations/reservations.repository.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { RoomsRepository } from '../rooms/rooms.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PricingRepository } from '../pricing/pricing.repository.js';

/** (Audit M-8) Thrown inside the locked update when the row is no longer in the expected state. */
class StaleOtaRow extends Error {}
const SYSTEM_META = { userId: SYSTEM_USER_ID, ip: undefined, requestId: undefined };

export interface ExportableStay {
  id: string;
  check_in_date: Date;
  check_out_date: Date;
}

export interface ImportRoom {
  id: string;
  code: string;
  booking_ical_url: string | null;
}

export interface ConflictRow {
  id: string;
  status: string;
  source: string;
  guest_name: string | null;
  check_in_date: Date;
  check_out_date: Date;
}

// Rows the feed reconciliation must know about: unclaimed blocks plus claimed
// (contact-attached) OTA bookings whose lifecycle staff now own.
export interface ActiveOtaRow {
  external_uid: string;
  status: string;
}

export class ChannelRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // ── Concurrency guard ─────────────────────────────────────────────────────────
  // One import at a time, cluster-wide: a cron tick overlapping a manual trigger
  // would race on the same UIDs. Session-scoped Postgres advisory lock; the key is
  // a fixed hash of 'lsp-channel-sync'.
  async tryAdvisoryLock(): Promise<boolean> {
    const row = await sql<{ locked: boolean }>`
      select pg_try_advisory_lock(hashtext('lsp-channel-sync')) as locked
    `.execute(this.db);
    return Boolean(row.rows[0]?.locked);
  }

  async releaseAdvisoryLock(): Promise<void> {
    await sql`select pg_advisory_unlock(hashtext('lsp-channel-sync'))`.execute(this.db);
  }

  // Resolve a unit by its public iCal token. Soft-deleted units have no live feed.
  async findRoomByIcalToken(token: string): Promise<RoomRow | undefined> {
    return this.db
      .selectFrom('rooms')
      .selectAll()
      .where('ical_token', '=', token)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  // The nights to publish to OTAs for one unit: every stay of ours from today onward.
  // BOOKING_COM-sourced rows are EXCLUDED here (NON_EXPORT_SOURCES) so
  // an OTA's own booking is never looped back to it. Past stays are dropped to keep the
  // feed small. The WHERE mirrors the EXPORT_* constants — the single source of truth.
  async findExportableStays(roomId: string): Promise<ExportableStay[]> {
    return this.db
      .selectFrom('reservations')
      .select(['id', 'check_in_date', 'check_out_date'])
      .where('room_id', '=', roomId)
      .where('deleted_at', 'is', null)
      .where('status', 'in', [...EXPORTABLE_STATUSES])
      .where('source', 'not in', [...NON_EXPORT_SOURCES])
      .where(sql<boolean>`check_out_date >= ${propertyToday()}`)
      .orderBy('check_in_date')
      .execute();
  }

  // ── Import side (Booking.com → LSP) ────────────────────────────────────────────

  // Units configured to import a Booking.com calendar.
  async listImportRooms(): Promise<ImportRoom[]> {
    return this.db
      .selectFrom('rooms')
      .select(['id', 'code', 'booking_ical_url'])
      .where('booking_ical_url', 'is not', null)
      .where('deleted_at', 'is', null)
      .execute();
  }

  // Find an imported block by its Booking.com VEVENT UID, in ANY state — the unique index
  // is on (source, external_uid), so this is how a re-poll updates/revives the same row
  // instead of duplicating it.
  async findBlockByUid(externalUid: string): Promise<ReservationRow | undefined> {
    return this.db
      .selectFrom('reservations')
      .selectAll()
      .where('source', '=', IMPORT_SOURCE)
      .where('external_uid', '=', externalUid)
      .executeTakeFirst();
  }

  // Insert a fresh OTA block. May raise 23P01 (reservations_no_overlap) if the night is
  // already direct-sold — the caller catches that and alerts. Whatever the feed said
  // about the night (SUMMARY/DESCRIPTION) is kept on notes — it is all the guest
  // context an iCal feed will ever carry (Tier 0 of the OTA contact-info plan).
  async insertImportedBlock(b: {
    roomId: string;
    externalUid: string;
    checkIn: Date;
    checkOut: Date;
    notes: string | null;
  }): Promise<string> {
    const row = await this.db
      .insertInto('reservations')
      .values({
        contact_id: SYSTEM_OTA_CONTACT_ID,
        room_id: b.roomId,
        check_in_date: b.checkIn,
        check_out_date: b.checkOut,
        status: IMPORT_STATUS,
        source: IMPORT_SOURCE,
        external_uid: b.externalUid,
        notes: b.notes,
        created_by: SYSTEM_USER_ID,
        updated_by: SYSTEM_USER_ID,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  // Refresh an UNCLAIMED block to match the feed (and revive it if it was cancelled).
  // The WHERE makes it a no-op when nothing differs — a 15-min poll must not rewrite
  // every row every tick (dead WAL/update churn). Returns true when a row was written.
  // May raise 23P01 if the new dates now collide with a direct sale.
  async updateBlock(
    id: string,
    b: { roomId: string; checkIn: Date; checkOut: Date; notes: string | null },
  ): Promise<boolean> {
    const res = await this.db
      .updateTable('reservations')
      .set({
        room_id: b.roomId,
        check_in_date: b.checkIn,
        check_out_date: b.checkOut,
        status: IMPORT_STATUS,
        notes: b.notes,
        deleted_at: null,
        deleted_by: null,
        updated_by: SYSTEM_USER_ID,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where((eb) =>
        eb.not(
          eb.and([
            eb('room_id', '=', b.roomId),
            eb('check_in_date', '=', b.checkIn),
            eb('check_out_date', '=', b.checkOut),
            eb('status', '=', IMPORT_STATUS),
            eb('deleted_at', 'is', null),
            sql<boolean>`notes is not distinct from ${b.notes}`,
          ]),
        ),
      )
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0) > 0;
  }

  // (Audit 2026-10-11, M-8) A claimed OTA booking has a real guest and may hold money, so a
  // change from the feed goes through the same locked, audited booking update as a change at
  // the desk. It used to be a bare UPDATE: no row lock, no audit row, no re-price — dates
  // moved under a frozen agreed total, and nobody could say who or what had moved them.
  //
  // Only a CONFIRMED booking moves. An in-house guest (CHECKED_IN) is never moved by the
  // feed — after check-in only an admin may change the arrival day (R11) — so it is left
  // for staff ('skipped'). The status is re-read under the lock, so a check-in that commits
  // while the sync runs is respected. A move the price rules refuse (e.g. it would take the
  // agreed total below zero) also comes back 'skipped'. A 23P01 overlap still throws, for the
  // caller's collision alert.
  async moveClaimedDates(
    id: string,
    b: { checkIn: Date; checkOut: Date }
  ): Promise<'moved' | 'unchanged' | 'skipped'> {
    const day = (d: Date) => new Date(d).toISOString().slice(0, 10);
    let unchanged = false;
    const pricer = new ReservationsService(
      new ReservationsRepository(this.db),
      new RoomsRepository(this.db),
      new PricingService(new PricingRepository(this.db))
    ).stayPricer();
    try {
      await new ReservationsRepository(this.db).update(
        id,
        { check_in_date: b.checkIn, check_out_date: b.checkOut, updated_by: SYSTEM_USER_ID },
        SYSTEM_META,
        undefined,
        {
          validate: (before) => {
            if (before.status !== 'CONFIRMED') throw new StaleOtaRow();
            if (day(before.check_in_date) === day(b.checkIn) && day(before.check_out_date) === day(b.checkOut)) {
              unchanged = true;
              throw new StaleOtaRow();
            }
          },
          ...(pricer ? { repriceStay: pricer } : {}),
        }
      );
      return 'moved';
    } catch (err) {
      if (err instanceof StaleOtaRow) return unchanged ? 'unchanged' : 'skipped';
      if ((err as { statusCode?: number }).statusCode === 409) return 'skipped';
      throw err;
    }
  }

  // End an OTA booking the feed cancelled. CANCELLED frees the night (it leaves the
  // no-overlap constraint) while keeping the row for audit/revival.
  //
  // (Audit M-8) Through the locked, audited update: a cancelled booking's open invoice is
  // voided and its holds released in the same transaction, as at the desk. `allowed` is
  // re-checked under the lock — a guest who checked in meanwhile is never cancelled.
  async cancelOtaBooking(id: string, allowed: ReadonlyArray<ReservationRow['status']>): Promise<boolean> {
    try {
      const done = await new ReservationsRepository(this.db).update(
        id,
        { status: 'CANCELLED', updated_by: SYSTEM_USER_ID },
        SYSTEM_META,
        undefined,
        {
          validate: (before) => {
            if (!allowed.includes(before.status)) throw new StaleOtaRow();
          },
        }
      );
      return Boolean(done);
    } catch (err) {
      if (err instanceof StaleOtaRow) return false;
      throw err;
    }
  }

  // This unit's currently-active OTA rows (unclaimed BLOCKED + claimed
  // CONFIRMED/CHECKED_IN) — used to detect events that have disappeared from the feed.
  async listActiveOtaRows(roomId: string): Promise<ActiveOtaRow[]> {
    const rows = await this.db
      .selectFrom('reservations')
      .select(['external_uid', 'status'])
      .where('room_id', '=', roomId)
      .where('source', '=', IMPORT_SOURCE)
      .where('status', 'in', [IMPORT_STATUS, 'CONFIRMED', 'CHECKED_IN'])
      .where('deleted_at', 'is', null)
      .where('external_uid', 'is not', null)
      .execute();
    return rows
      .filter((r) => Boolean(r.external_uid))
      .map((r) => ({ external_uid: r.external_uid!, status: r.status }));
  }

  // The DIRECT/WEBSITE stays an OTA night collides with: same unit, overlapping dates,
  // blocking status, not OTA-sourced. These are the details that go into the alert.
  async findConflicts(roomId: string, checkIn: Date, checkOut: Date): Promise<ConflictRow[]> {
    return this.db
      .selectFrom('reservations as r')
      .leftJoin('contacts as c', 'c.id', 'r.contact_id')
      .select(['r.id', 'r.status', 'r.source', 'r.check_in_date', 'r.check_out_date', 'c.name as guest_name'])
      .where('r.room_id', '=', roomId)
      .where('r.deleted_at', 'is', null)
      .where('r.source', '!=', IMPORT_SOURCE)
      .where('r.status', 'in', ['PENDING', 'CONFIRMED', 'CHECKED_IN'])
      .where('r.check_in_date', '<', checkOut)
      .where('r.check_out_date', '>', checkIn)
      .execute();
  }

  // Throttle ledger: has a collision for THIS OTA event already been paged within the
  // window? The dashboard alert writes a `channel_collision` audit row stamped with the
  // event UID (diff->>'otaUid'), so that row IS the record — no extra table needed.
  async recentCollisionAlertExists(otaUid: string, withinHours: number): Promise<boolean> {
    const row = await this.db
      .selectFrom('audit_logs')
      .select(sql<number>`1`.as('hit'))
      .where('entity', '=', 'channel_collision')
      .where(sql<boolean>`created_at > now() - make_interval(hours => ${withinHours})`)
      .where(sql<boolean>`diff->>'otaUid' = ${otaUid}`)
      .limit(1)
      .executeTakeFirst();
    return Boolean(row);
  }
}
