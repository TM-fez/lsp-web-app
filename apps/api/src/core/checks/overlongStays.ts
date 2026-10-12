import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { MAX_STAY_NIGHTS } from '../stayLimits.js';
import { logger } from '../logger.js';
import { NotificationsRepository } from '../../modules/notifications/notifications.repository.js';

/**
 * (Audit 2026-10-11, H-1 follow-up) Look once, at every boot, for bookings already saved with a
 * stay longer than the price engine will now price (MAX_STAY_NIGHTS).
 *
 * Before the H-1 fix a single public booking could be dated thousands of years long. Such a row
 * no longer crashes anything — screens that price it now answer "too long" — but it would still
 * hold its unit and confuse staff. The owner asked for the server to check itself rather than
 * run a query by hand: the result goes to the log, and every active admin gets one bell
 * notification per booking found (deduplicated, so a restart doesn't repeat it). Read-only on
 * the bookings themselves: deciding what to do with one is for a person.
 */
export async function reportOverlongStays(db: Kysely<Database>): Promise<string[]> {
  const rows = await db
    .selectFrom('reservations')
    .select(['id', 'check_in_date', 'check_out_date'])
    .where('deleted_at', 'is', null)
    .where(sql<boolean>`check_out_date - check_in_date > ${MAX_STAY_NIGHTS}`)
    .execute();

  if (rows.length === 0) {
    logger.info(`[startup-check] no bookings longer than ${MAX_STAY_NIGHTS} nights — all clear`);
    return [];
  }

  const ids = rows.map((r) => r.id);
  logger.warn({ reservationIds: ids }, `[startup-check] ${ids.length} booking(s) longer than ${MAX_STAY_NIGHTS} nights — review them`);

  const admins = await db
    .selectFrom('users as u')
    .innerJoin('roles as r', 'r.id', 'u.role_id')
    .select('u.id')
    .where('r.name', '=', 'admin')
    .where('u.active', '=', true)
    .execute();

  const day = (d: Date) => new Date(d).toISOString().slice(0, 10);
  await new NotificationsRepository(db).insertMany(
    rows.flatMap((r) =>
      admins.map((a) => ({
        user_id: a.id,
        property_id: null,
        type: 'check.overlong_stay',
        title: 'A booking has an impossibly long stay',
        body: `Booked from ${day(r.check_in_date)} to ${day(r.check_out_date)} — longer than the ${MAX_STAY_NIGHTS}-night maximum. It was probably made before the October security fix. Please check it and cancel or correct it.`,
        entity_type: 'reservations',
        entity_id: r.id,
        link: `/reservations/${r.id}`,
        dedup_key: `overlong-stay:${r.id}:${a.id}`,
      }))
    )
  );
  return ids;
}
