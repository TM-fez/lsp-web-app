import { db } from '../../config/db.js';
import type { RawStatsRow } from './dashboard.types.js';

// ── Aggregate queries — no business logic ─────────────────────────────────────

/**
 * Runs the COUNT queries in parallel and returns raw totals.
 * The caller is responsible for caching.
 */
export async function getAggregateStats(): Promise<RawStatsRow> {
  const [contacts, users] = await Promise.all([
    db
      .selectFrom('contacts')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow(),

    db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('active', '=', true)
      .executeTakeFirstOrThrow(),
  ]);

  return {
    totalContacts: parseInt(contacts.count, 10),
    totalUsers:    parseInt(users.count, 10),
  };
}
