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
 *  - room.status OCCUPIED -> NOT a block. It is a "right now" flag that check-in sets
 *    and check-out clears, so treating it as structural blocked every future range too
 *    — the same D06 bug as the occupancy join, by a second route. Today is covered by
 *    the CHECKED_IN reservation and by the bounded occupancy leg; both know the dates,
 *    and r.status does not. MAINTENANCE / OUT_OF_SERVICE remain structural because
 *    there is no way to say when they end (D07) — over-blocking there is deliberate.
 *  - overlapping PENDING, CONFIRMED, CHECKED_IN or BLOCKED reservation in the range
 *    -> reserved (BLOCKED = a Booking.com night imported by channel sync; migration
 *    046). This is the same four-status set the `reservations_no_overlap` constraint
 *    whitelists, which is why search and the DB cannot disagree.
 *  - an active CHECKED_IN occupancy -> occupied, but ONLY for a range that includes
 *    today (defect D06, fixed 2026-09-07)
 *
 * D06, and why the occupancy leg is bounded rather than deleted: it used to carry no
 * date predicate at all, so ANY unit with a guest in it tonight read as unavailable for
 * EVERY future range — ask "what is free next month" and the house looked full. The
 * naive fix is to drop the leg, since CHECKED_IN now sits in the date-bounded
 * reservation whitelist and covers the guest's scheduled nights. But that would lose
 * the one case the leg genuinely earns: an OVERSTAY. A guest whose check_out_date has
 * passed and who has not checked out is still physically in the room, and their
 * reservation's dates no longer say so. So the leg stays, bounded to today — the only
 * day on which "they are still in there" is a fact rather than a guess. Beyond today it
 * is a guess, and over-blocking a month of inventory on a guess is what caused D06.
 * The cockpit's overdue rail is where staff resolve the overstay itself.
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
        WHERE deleted_at IS NULL AND status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
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
        -- Only for a range that INCLUDES today. See the D06 note on the class.
        AND ${range.checkIn}::date <= (now() AT TIME ZONE 'Africa/Gaborone')::date
        AND ${range.checkOut}::date > (now() AT TIME ZONE 'Africa/Gaborone')::date
      WHERE r.deleted_at IS NULL
        AND (${roomType}::text IS NULL OR r.type = ${roomType}::room_type)
        AND r.capacity >= ${filters.minCapacity}
        AND (${propertyId}::uuid IS NULL OR r.building_id IN (SELECT id FROM buildings WHERE property_id = ${propertyId}::uuid))
        AND (NOT ${availableOnly} OR (r.status NOT IN ('MAINTENANCE', 'OUT_OF_SERVICE') AND coalesce(res.cnt, 0) = 0 AND coalesce(occ.cnt, 0) = 0))
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
        count(*) FILTER (WHERE r.status NOT IN ('MAINTENANCE', 'OUT_OF_SERVICE') AND coalesce(res.cnt, 0) = 0 AND coalesce(occ.cnt, 0) = 0)::int AS available,
        count(*) FILTER (WHERE r.status = 'MAINTENANCE')::int AS maintenance,
        count(*) FILTER (WHERE r.status = 'OUT_OF_SERVICE')::int AS out_of_service,
        -- Occupancy is a fact about TODAY, so it is counted from the (now bounded) occ
        -- leg, never from r.status — a unit occupied tonight is not occupied in March.
        count(*) FILTER (WHERE coalesce(occ.cnt, 0) > 0)::int AS occupied,
        count(*) FILTER (WHERE r.status NOT IN ('MAINTENANCE', 'OUT_OF_SERVICE') AND coalesce(occ.cnt, 0) = 0 AND coalesce(res.cnt, 0) > 0)::int AS reserved
      FROM rooms r
      LEFT JOIN (
        SELECT room_id, count(*) AS cnt
        FROM reservations
        WHERE deleted_at IS NULL AND status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
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
        -- Only for a range that INCLUDES today. See the D06 note on the class.
        AND ${range.checkIn}::date <= (now() AT TIME ZONE 'Africa/Gaborone')::date
        AND ${range.checkOut}::date > (now() AT TIME ZONE 'Africa/Gaborone')::date
      WHERE r.deleted_at IS NULL
        AND (${roomType}::text IS NULL OR r.type = ${roomType}::room_type)
        AND r.capacity >= ${filters.minCapacity}
        AND (${propertyId}::uuid IS NULL OR r.building_id IN (SELECT id FROM buildings WHERE property_id = ${propertyId}::uuid))
    `.execute(this.db);

    return result.rows[0]!;
  }

  // Per-day availability across the range in one query (generate_series, no loop).
  // Structural blocks (room.status) apply to the whole range; reservations are per-day;
  // an active occupancy applies to TODAY only (D06).
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
        count(r.id) FILTER (WHERE r.status NOT IN ('MAINTENANCE', 'OUT_OF_SERVICE') AND res.id IS NULL AND occ.id IS NULL)::int AS free_rooms
      FROM days d
      CROSS JOIN rooms r
      LEFT JOIN LATERAL (
        SELECT 1 AS id FROM reservations res
        WHERE res.room_id = r.id AND res.deleted_at IS NULL AND res.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
          AND res.check_in_date <= d.day AND res.check_out_date > d.day
        LIMIT 1
      ) res ON true
      LEFT JOIN LATERAL (
        SELECT 1 AS id FROM occupancy occ
        WHERE occ.room_id = r.id AND occ.deleted_at IS NULL AND occ.status = 'CHECKED_IN'
          -- Today's column only (D06). The guest's SCHEDULED nights are already covered
          -- by the reservation leg above, now that CHECKED_IN is in its whitelist; what
          -- this adds is the overstay, and an overstay is only knowable as of today.
          AND d.day = (now() AT TIME ZONE 'Africa/Gaborone')::date
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
