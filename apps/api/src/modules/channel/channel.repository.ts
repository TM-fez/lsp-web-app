import { Kysely, sql } from 'kysely';
import type { Database, RoomRow, ReservationRow } from '../../db/types.js';
import { propertyToday } from '../../core/time.js';
import {
  EXPORTABLE_STATUSES,
  EXPORT_SOURCES,
  IMPORT_SOURCE,
  IMPORT_STATUS,
  SYSTEM_USER_ID,
  SYSTEM_OTA_CONTACT_ID,
} from './channel.types.js';

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

  // The nights to publish to OTAs for one unit: its own DIRECT/WEBSITE sold stays from
  // today onward. BOOKING_COM-sourced BLOCKED rows are EXCLUDED here (EXPORT_SOURCES) so
  // an OTA's own booking is never looped back to it. Past stays are dropped to keep the
  // feed small. The WHERE mirrors the EXPORT_* constants — the single source of truth.
  async findExportableStays(roomId: string): Promise<ExportableStay[]> {
    return this.db
      .selectFrom('reservations')
      .select(['id', 'check_in_date', 'check_out_date'])
      .where('room_id', '=', roomId)
      .where('deleted_at', 'is', null)
      .where('status', 'in', [...EXPORTABLE_STATUSES])
      .where('source', 'in', [...EXPORT_SOURCES])
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

  // A claimed OTA booking (real contact attached, staff own the lifecycle): the feed
  // may still move its DATES, but status/contact/notes stay untouched. No-op when the
  // dates already match. Returns true when a row was written.
  async updateClaimedDates(id: string, b: { checkIn: Date; checkOut: Date }): Promise<boolean> {
    const res = await this.db
      .updateTable('reservations')
      .set({
        check_in_date: b.checkIn,
        check_out_date: b.checkOut,
        updated_by: SYSTEM_USER_ID,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .where((eb) =>
        eb.not(eb.and([eb('check_in_date', '=', b.checkIn), eb('check_out_date', '=', b.checkOut)])),
      )
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0) > 0;
  }

  // End a block (event cancelled or vanished from the feed) — CANCELLED frees the night
  // (it leaves the no-overlap constraint) while keeping the row for audit/revival.
  async cancelBlock(id: string): Promise<void> {
    await this.db
      .updateTable('reservations')
      .set({ status: 'CANCELLED', updated_by: SYSTEM_USER_ID, updated_at: new Date() })
      .where('id', '=', id)
      .execute();
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
