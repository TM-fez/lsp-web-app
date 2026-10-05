import { sql, type RawBuilder } from 'kysely';

/**
 * (R5, migration 085) The one definition of "a repair takes this unit out of use on
 * these nights".
 *
 * A HIGH / CRITICAL work order that is still open and carries a block window blocks
 * exactly the nights in `[blocks_from, blocks_to)`. One WITHOUT a window is not handled
 * here: it puts the unit's status to MAINTENANCE, which every reader already treats as
 * blocking all dates. Every place that decides "is this unit free" — the three
 * availability queries and `ReservationsRepository.checkAvailability` — must use these,
 * so search and booking can never disagree (the D01 lesson).
 */
const LIVE_SERIOUS_WINDOW = sql`w.deleted_at IS NULL
  AND w.status NOT IN ('COMPLETED', 'CANCELLED')
  AND w.priority IN ('HIGH', 'CRITICAL')
  AND w.blocks_from IS NOT NULL`;

/** True when a live repair window on `roomRef` overlaps the half-open range [checkIn, checkOut). */
export function repairWindowOverlaps(
  roomRef: RawBuilder<unknown>,
  checkIn: Date | string,
  checkOut: Date | string
): RawBuilder<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM maintenance_work_orders w
     WHERE w.room_id = ${roomRef} AND ${LIVE_SERIOUS_WINDOW}
       AND w.blocks_from < ${checkOut}::date AND w.blocks_to > ${checkIn}::date)`;
}

/** True when a live repair window on `roomRef` covers the single night `day`. */
export function repairWindowCovers(roomRef: RawBuilder<unknown>, day: RawBuilder<unknown>): RawBuilder<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM maintenance_work_orders w
     WHERE w.room_id = ${roomRef} AND ${LIVE_SERIOUS_WINDOW}
       AND w.blocks_from <= ${day} AND w.blocks_to > ${day})`;
}
