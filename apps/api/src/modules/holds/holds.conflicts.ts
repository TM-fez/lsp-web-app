import { sql, type Kysely } from 'kysely';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/AppError.js';
import type { Database } from '../../db/types.js';

/**
 * (Round 4) A hold with a unit but no booking behind it is the one kind of hold that
 * reserves a unit on its own (`holds_active_room_unique`). Two things were missing:
 * a booking on the same nights was not refused, and the message when the index says no
 * blamed the quote even when the real reason was another quote holding the unit.
 */

/**
 * Refuse a new booking that overlaps a live, booking-less hold on the same unit. The hold's
 * dates are its quote's; it lapses by itself after 30 minutes or can be released.
 */
export async function assertNoCompetingHold(
  db: Kysely<Database>,
  roomId: string,
  checkIn: Date | string,
  checkOut: Date | string,
): Promise<void> {
  const clash = await sql<{ held_until: Date }>`
    SELECT h.held_until FROM holds h JOIN quotes q ON q.id = h.quote_id
     WHERE h.room_id = ${roomId}::uuid AND h.status = 'HELD' AND h.deleted_at IS NULL
       AND h.reservation_id IS NULL AND h.held_until > now()
       AND daterange(q.check_in_date, q.check_out_date) && daterange(${day(checkIn)}::date, ${day(checkOut)}::date)
     LIMIT 1`.execute(db);
  if (clash.rows.length) {
    throw AppError.conflict(
      'That unit is being held for another guest’s quote for some of those dates. Release the hold, or wait for it to lapse (it lasts 30 minutes), then try again.',
    );
  }
}

/** Which unique rule said no? The two indexes mean very different things to the person reading. */
export function holdConflictMessage(err: unknown): string {
  const constraint = (err as { constraint?: string } | null)?.constraint ?? '';
  return constraint === 'holds_active_room_unique'
    ? 'That unit is already being held for another quote that has no booking attached. Release that hold first, or attach the hold to a booking.'
    : 'This quote already has a live hold. Use it, or release it first.';
}

function day(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

/** Route guard for POST /reservations: the new booking may not sit on a unit someone is holding. */
export function rejectOverlappingHold(db: Kysely<Database>) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const b = req.body as { room_id?: string; check_in_date?: Date | string; check_out_date?: Date | string };
      if (b.room_id && b.check_in_date && b.check_out_date) {
        await assertNoCompetingHold(db, b.room_id, b.check_in_date, b.check_out_date);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
