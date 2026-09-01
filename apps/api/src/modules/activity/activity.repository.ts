import type { Kysely } from 'kysely';
import type { Database } from '../../db/types.js';

// Entities kept out of a shared "what's happening" feed: session plumbing, which is
// noise, and staff pay, which is nobody else's business. The feed never renders the
// diff, so no figure leaked — but "Tumelo updated a record" against staff_compensation
// still tells the whole team that somebody's salary was touched, and by whom.
const HIDE = ['auth_login', 'refresh_token', 'staff_compensation'];

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
