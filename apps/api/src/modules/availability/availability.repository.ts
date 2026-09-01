import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import type {
  DateRange,
  AvailabilityFilters,
  RoomSignalRow,
  SummaryCountsRow,
  CalendarDayRow,
} from './availability.types.js';

/**
 * Read-only availability domain. It reads rooms, reservations and occupancy as
 * sibling sources and never mutates. Every method issues a single aggregated
 * query (no N+1, no per-room/per-day loops).
 *
 * Blocking model:
 *  - room.status MAINTENANCE / OUT_OF_SERVICE  -> structurally blocked
 *  - room.status OCCUPIED or active CHECKED_IN occupancy -> occupied
 *  - overlapping PENDING, CONFIRMED or BLOCKED reservation in the range -> reserved
 *    (BLOCKED = a Booking.com night imported by channel sync; migration 046)
 *
 * PENDING counts (defect D01, owner decision 2026-09-01: an unpaid booking DOES hold
 * the room). It used to be absent here while `ReservationsRepository.checkAvailability`
 * and the `reservations_no_overlap` constraint both blocked on it — so two definitions
 * of "blocked" were live at once and a unit read as free in search, then 409'd the
 * moment you tried to book it. Public /stay bookings sit PENDING for up to
 * WEBSITE_PENDING_TTL_HOURS, so this bit hardest on direct bookings.
 *
 * If that policy is ever reversed, all three must move together: this file, that
 * repository's blacklist, and the DB constraint in migration 046.
 */
export class AvailabilityRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // Per-room signals for a date range, paginated. `count(*) OVER()` returns the
  // unpaginated total in the same query. `availableOnly` filters to bookable rooms.
  async findRoomSignals(
    range: DateRange,
    filters: AvailabilityFilters,
    pagination: { page: number; limit: number },
    availableOnly: boolean
  ): Promise<RoomSignalRow[]> {
    const offset = (pagination.page - 1) * pagination.limit;
    const roomType = filters.roomType ?? null;
    const propertyId = filters.propertyId ?? null;

    const result = await sql<RoomSignalRow>`
      SELECT r.id, r.name, r.code, r.type, r.status, r.capacity,
        coalesce(res.cnt, 0)::int AS overlapping_reservations,
        coalesce(occ.cnt, 0)::int AS active_occupancy,
        count(*) OVER()::int AS total_count
      FROM rooms r
      LEFT JOIN (
        SELECT room_id, count(*) AS cnt
        FROM reservations
        WHERE deleted_at IS NULL AND status IN ('PENDING', 'CONFIRMED', 'BLOCKED')
          AND check_in_date < ${range.checkOut}::date
          AND check_out_date > ${range.checkIn}::date
        GROUP BY room_id
      ) res ON res.room_id = r.id
      LEFT JOIN (
        SELECT room_id, count(*) AS cnt
        FROM occupancy
        WHERE deleted_at IS NULL AND status = 'CHECKED_IN'
        GROUP BY room_id
      ) occ ON occ.room_id = r.id
      WHERE r.deleted_at IS NULL
        AND (${roomType}::text IS NULL OR r.type = ${roomType}::room_type)
        AND r.capacity >= ${filters.minCapacity}
        AND (${propertyId}::uuid IS NULL OR r.building_id IN (SELECT id FROM buildings WHERE property_id = ${propertyId}::uuid))
        AND (NOT ${availableOnly} OR (r.status = 'AVAILABLE' AND coalesce(res.cnt, 0) = 0 AND coalesce(occ.cnt, 0) = 0))
      ORDER BY r.code
      LIMIT ${pagination.limit} OFFSET ${offset}
    `.execute(this.db);

    return result.rows;
  }

  // Property-wide counts for a date range in one aggregated query (for quotes).
  async getSummaryCounts(range: DateRange, filters: AvailabilityFilters): Promise<SummaryCountsRow> {
    const roomType = filters.roomType ?? null;
    const propertyId = filters.propertyId ?? null;

    const result = await sql<SummaryCountsRow>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE r.status = 'AVAILABLE' AND coalesce(res.cnt, 0) = 0 AND coalesce(occ.cnt, 0) = 0)::int AS available,
        count(*) FILTER (WHERE r.status = 'MAINTENANCE')::int AS maintenance,
        count(*) FILTER (WHERE r.status = 'OUT_OF_SERVICE')::int AS out_of_service,
        count(*) FILTER (WHERE r.status = 'OCCUPIED' OR coalesce(occ.cnt, 0) > 0)::int AS occupied,
        count(*) FILTER (WHERE r.status = 'AVAILABLE' AND coalesce(occ.cnt, 0) = 0 AND coalesce(res.cnt, 0) > 0)::int AS reserved
      FROM rooms r
      LEFT JOIN (
        SELECT room_id, count(*) AS cnt
        FROM reservations
        WHERE deleted_at IS NULL AND status IN ('PENDING', 'CONFIRMED', 'BLOCKED')
          AND check_in_date < ${range.checkOut}::date
          AND check_out_date > ${range.checkIn}::date
        GROUP BY room_id
      ) res ON res.room_id = r.id
      LEFT JOIN (
        SELECT room_id, count(*) AS cnt
        FROM occupancy
        WHERE deleted_at IS NULL AND status = 'CHECKED_IN'
        GROUP BY room_id
      ) occ ON occ.room_id = r.id
      WHERE r.deleted_at IS NULL
        AND (${roomType}::text IS NULL OR r.type = ${roomType}::room_type)
        AND r.capacity >= ${filters.minCapacity}
        AND (${propertyId}::uuid IS NULL OR r.building_id IN (SELECT id FROM buildings WHERE property_id = ${propertyId}::uuid))
    `.execute(this.db);

    return result.rows[0]!;
  }

  // Per-day availability across the range in one query (generate_series, no loop).
  // Structural/occupancy blocks apply to the whole range; reservations are per-day.
  async getCalendar(range: DateRange, filters: AvailabilityFilters): Promise<CalendarDayRow[]> {
    const roomType = filters.roomType ?? null;
    const propertyId = filters.propertyId ?? null;

    const result = await sql<CalendarDayRow>`
      WITH days AS (
        SELECT generate_series(${range.checkIn}::date, ${range.checkOut}::date - interval '1 day', interval '1 day')::date AS day
      )
      SELECT d.day::text AS day,
        count(r.id)::int AS total_rooms,
        count(r.id) FILTER (WHERE r.status IN ('MAINTENANCE', 'OUT_OF_SERVICE'))::int AS structural_blocked,
        count(r.id) FILTER (WHERE r.status = 'AVAILABLE' AND res.id IS NULL AND occ.id IS NULL)::int AS free_rooms
      FROM days d
      CROSS JOIN rooms r
      LEFT JOIN LATERAL (
        SELECT 1 AS id FROM reservations res
        WHERE res.room_id = r.id AND res.deleted_at IS NULL AND res.status IN ('PENDING', 'CONFIRMED', 'BLOCKED')
          AND res.check_in_date <= d.day AND res.check_out_date > d.day
        LIMIT 1
      ) res ON true
      LEFT JOIN LATERAL (
        SELECT 1 AS id FROM occupancy occ
        WHERE occ.room_id = r.id AND occ.deleted_at IS NULL AND occ.status = 'CHECKED_IN'
        LIMIT 1
      ) occ ON true
      WHERE r.deleted_at IS NULL
        AND (${roomType}::text IS NULL OR r.type = ${roomType}::room_type)
        AND r.capacity >= ${filters.minCapacity}
        AND (${propertyId}::uuid IS NULL OR r.building_id IN (SELECT id FROM buildings WHERE property_id = ${propertyId}::uuid))
      GROUP BY d.day
      ORDER BY d.day
    `.execute(this.db);

    return result.rows;
  }
}
