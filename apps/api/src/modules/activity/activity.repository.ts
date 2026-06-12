import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';

// Entities that are noise in a "what's happening" feed.
const HIDE = ['auth_login', 'refresh_token'];

export class ActivityRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async recent(limit = 30) {
    return this.db
      .selectFrom('audit_logs as a')
      .leftJoin('users as u', 'u.id', 'a.user_id')
      .select(['a.id', 'a.action', 'a.entity', 'a.diff', 'a.created_at', 'u.name as actor_name'])
      .where('a.entity', 'not in', HIDE)
      .orderBy('a.created_at', 'desc')
      .limit(limit)
      .execute();
  }
}
