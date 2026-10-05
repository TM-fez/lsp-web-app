import { db } from '../../config/db.js';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { RawStatsRow, StatsScope } from './dashboard.types.js';
import { contactVisibleSql } from '../../core/scope/contactScope.js';

// ── Aggregate queries — no business logic ─────────────────────────────────────

/**
 * Runs the COUNT queries in parallel and returns raw totals.
 * The caller is responsible for caching.
 */
// `exec` lets a test take two counts from one snapshot (see round4-dashboard-directory-scope).
export async function getAggregateStats(scope?: StatsScope, exec: Kysely<Database> = db): Promise<RawStatsRow> {
  // (Round 4) A user limited to some properties counts the guests they may see (same rule as
  // the guest list) and the staff who share one of their properties — not the whole house.
  const limited = !!scope && !scope.allProperties;
  const ids = scope?.ids ?? [];

  const [contacts, users] = await Promise.all([
    exec
      .selectFrom('contacts')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('deleted_at', 'is', null)
      .$if(limited, (qb) => qb.where(contactVisibleSql('contacts', ids, scope!.userId)))
      .executeTakeFirstOrThrow(),

    exec
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('active', '=', true)
      .$if(limited, (qb) =>
        qb.where(
          ids.length === 0
            ? sql<boolean>`false`
            : sql<boolean>`EXISTS (SELECT 1 FROM user_properties dup WHERE dup.user_id = users.id AND dup.property_id IN (${sql.join(ids)}))`
        )
      )
      .executeTakeFirstOrThrow(),
  ]);

  return {
    totalContacts: parseInt(contacts.count, 10),
    totalUsers:    parseInt(users.count, 10),
  };
}
