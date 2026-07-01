import type { Kysely } from 'kysely';
import type { Database, NewNotification, NotificationRow } from '../../db/types.js';

export interface ListOptions {
  unreadOnly?: boolean;
  limit?: number;
}

export class NotificationsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Bulk insert, skipping any row whose `dedup_key` already exists. That's what
   * makes the reminder sweep safe to run on a timer: the second run's rows collide
   * on the partial-unique index and are dropped. Returns how many were actually
   * inserted. Ad-hoc rows (NULL dedup_key) never collide.
   */
  async insertMany(rows: NewNotification[]): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await this.db
      .insertInto('notifications')
      .values(rows)
      // The dedup index is PARTIAL (WHERE dedup_key IS NOT NULL), so the conflict
      // target must repeat that predicate for Postgres to use it as the arbiter.
      // NULL-key rows don't match the predicate, so they always insert.
      .onConflict((oc) => oc.column('dedup_key').where('dedup_key', 'is not', null).doNothing())
      .returning('id')
      .execute();
    return inserted.length;
  }

  /**
   * The user ids that should receive a property-scoped alert: every active member
   * of the property (via user_properties) plus every active admin (a wildcard that
   * holds no membership rows). Deduped.
   */
  async userIdsForProperty(propertyId: string): Promise<string[]> {
    const members = await this.db
      .selectFrom('user_properties as up')
      .innerJoin('users as u', 'u.id', 'up.user_id')
      .select('u.id')
      .where('up.property_id', '=', propertyId)
      .where('u.active', '=', true)
      .execute();

    const admins = await this.db
      .selectFrom('users as u')
      .innerJoin('roles as r', 'r.id', 'u.role_id')
      .select('u.id')
      .where('r.name', '=', 'admin')
      .where('u.active', '=', true)
      .execute();

    return [...new Set([...members, ...admins].map((r) => r.id))];
  }

  async listForUser(userId: string, opts: ListOptions = {}): Promise<NotificationRow[]> {
    let q = this.db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', userId);
    if (opts.unreadOnly) q = q.where('read_at', 'is', null);
    return q
      .orderBy('created_at', 'desc')
      .limit(Math.min(opts.limit ?? 30, 100))
      .execute();
  }

  async unreadCount(userId: string): Promise<number> {
    const row = await this.db
      .selectFrom('notifications')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /** Mark the given ids read — scoped to the caller, so you can't touch another's rows. */
  async markRead(userId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('user_id', '=', userId)
      .where('id', 'in', ids)
      .where('read_at', 'is', null)
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await this.db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }
}
