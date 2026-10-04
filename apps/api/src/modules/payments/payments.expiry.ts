import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/types.js';

/**
 * (Round 4, R3-L4) When the sweep lets go of an expired hold, the payment attempt waiting on
 * it must stop being "awaiting" — it can never succeed now (a payment against a dead hold is
 * refused). Marks those intents EXPIRED and writes one audit row each, in one transaction.
 *
 * Idempotent and cheap (indexed on status), so the scheduler runs it every tick; that also
 * covers holds that were swept by hand through the manual sweep endpoint.
 * Returns how many attempts it closed.
 */
export async function expireIntentsOfDeadHolds(db: Kysely<Database>): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const closed = await sql<{ id: string }>`
      UPDATE payment_intents pi
         SET status = 'EXPIRED', last_error = 'hold expired', updated_at = now(), updated_by = pi.created_by
        FROM holds h
       WHERE h.id = pi.hold_id
         AND h.status = 'EXPIRED'
         AND pi.status IN ('PENDING', 'RETRY')
      RETURNING pi.id`.execute(trx);
    if (closed.rows.length === 0) return 0;

    await trx
      .insertInto('audit_logs')
      .values(
        closed.rows.map((r) => ({
          request_id: null,
          user_id: null,
          action: 'UPDATE' as const,
          entity: 'payment_intents',
          entity_id: r.id,
          diff: { status: 'EXPIRED', reason: 'hold expired', via: 'sweep' },
          ip_address: null,
        })),
      )
      .execute();
    return closed.rows.length;
  });
}
