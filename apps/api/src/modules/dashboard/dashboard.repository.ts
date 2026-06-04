import { db } from '../../config/db.js';
import type { RawStatsRow, RawActivityRow } from './dashboard.types.js';

// ── Aggregate queries — no business logic ─────────────────────────────────────

/**
 * Runs three parallel COUNT queries and returns raw totals.
 * The caller is responsible for caching.
 */
export async function getAggregateStats(): Promise<RawStatsRow> {
  const [contacts, users, flags] = await Promise.all([
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

    db
      .selectFrom('feature_flags')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('enabled', '=', true)
      .executeTakeFirstOrThrow(),
  ]);

  return {
    totalContacts:      parseInt(contacts.count, 10),
    totalUsers:         parseInt(users.count, 10),
    activeFeatureFlags: parseInt(flags.count, 10),
  };
}

/**
 * Returns the most recent audit log entries joined with actor name.
 * Always fetches live — activity is not cached.
 */
export async function getRecentAuditActivity(limit: number): Promise<RawActivityRow[]> {
  const rows = await db
    .selectFrom('audit_logs')
    .leftJoin('users', 'users.id', 'audit_logs.user_id')
    .select([
      'audit_logs.id',
      'audit_logs.action',
      'audit_logs.entity',
      'audit_logs.entity_id',
      'audit_logs.user_id',
      'audit_logs.created_at',
    ])
    .select((eb) => eb.ref('users.name').as('user_name'))
    .orderBy('audit_logs.created_at', 'desc')
    .limit(limit)
    .execute();

  return rows.map((r) => ({
    id:        r.id,
    action:    r.action as RawActivityRow['action'],
    entity:    r.entity,
    entityId:  r.entity_id,
    userId:    r.user_id,
    userName:  (r as unknown as { user_name: string | null }).user_name,
    createdAt: r.created_at,
  }));
}
