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

export class ChannelRepository {
  constructor(private readonly db: Kysely<Database>) {}

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
  // already direct-sold — the caller catches that and alerts.
  async insertImportedBlock(b: { roomId: string; externalUid: string; checkIn: Date; checkOut: Date }): Promise<string> {
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
        created_by: SYSTEM_USER_ID,
        updated_by: SYSTEM_USER_ID,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  // Update an existing block to match the feed (and revive it if it was cancelled). May
  // also raise 23P01 if the new dates now collide with a direct sale.
  async updateBlock(id: string, b: { roomId: string; checkIn: Date; checkOut: Date }): Promise<void> {
    await this.db
      .updateTable('reservations')
      .set({
        room_id: b.roomId,
        check_in_date: b.checkIn,
        check_out_date: b.checkOut,
        status: IMPORT_STATUS,
        deleted_at: null,
        deleted_by: null,
        updated_by: SYSTEM_USER_ID,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
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

  // UIDs of this unit's currently-active OTA blocks — used to detect events that have
  // disappeared from the feed.
  async listActiveBlockUids(roomId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('reservations')
      .select('external_uid')
      .where('room_id', '=', roomId)
      .where('source', '=', IMPORT_SOURCE)
      .where('status', '=', IMPORT_STATUS)
      .where('deleted_at', 'is', null)
      .where('external_uid', 'is not', null)
      .execute();
    return rows.map((r) => r.external_uid!).filter(Boolean);
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
