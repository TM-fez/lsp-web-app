import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import { REFUND_LOWERED_REASON } from '../../core/money/folio.js';

/**
 * (R10 #6) Live bookings whose money all went back but whose agreed total was never lowered.
 *
 * Since 2026-10-02 a refund lowers the agreed total by the same amount, so a full refund
 * leaves a booking at P0 — "fully refunded". Bookings refunded BEFORE that rule kept their
 * old total: their folio reads REFUNDED now (R10), but on paper they still owe the whole
 * stay, and the open invoice may say so. Whether that debt is real (the guest is staying and
 * owes) or not (the stay is off and should be cancelled) is a person's call, so this only
 * lists them. Read-only.
 */
export interface UnloweredRefund {
  reservation_id: string;
  status: string;
  guest_name: string | null;
  room_code: string | null;
  check_in_date: string;
  check_out_date: string;
  agreed_total: number;
  refunded: number;
}

export async function findUnloweredRefunds(db: Kysely<Database>): Promise<UnloweredRefund[]> {
  const rows = await sql<UnloweredRefund & { agreed_total: string; refunded: string }>`
    WITH money AS (
      SELECT i.reservation_id,
             SUM(CASE WHEN i.kind = 'REFUND' THEN -i.total_amount ELSE i.total_amount END) AS paid,
             SUM(CASE WHEN i.kind = 'REFUND' THEN i.total_amount ELSE 0 END) AS refunded
        FROM invoices i
       WHERE i.deleted_at IS NULL AND i.status IN ('PAID', 'REFUNDED') AND i.reservation_id IS NOT NULL
       GROUP BY i.reservation_id
    )
    SELECT r.id AS reservation_id, r.status, c.name AS guest_name, rm.code AS room_code,
           to_char(r.check_in_date, 'YYYY-MM-DD') AS check_in_date,
           to_char(r.check_out_date, 'YYYY-MM-DD') AS check_out_date,
           r.folio_total_amount AS agreed_total, m.refunded
      FROM reservations r
      JOIN money m ON m.reservation_id = r.id
      LEFT JOIN contacts c ON c.id = r.contact_id
      LEFT JOIN rooms rm ON rm.id = r.room_id
     WHERE r.deleted_at IS NULL
       AND r.status NOT IN ('CANCELLED', 'NO_SHOW')
       -- (Round 11, N11-2) A refund that lowered the total is today's rule at work, not a
       -- legacy one: a deposit refunded on a stay that still owes the rest belongs here no more.
       AND NOT EXISTS (
         SELECT 1 FROM audit_logs a
          WHERE a.entity = 'reservations' AND a.entity_id = r.id::text
            AND a.diff->>'reason' = ${REFUND_LOWERED_REASON})
       AND r.folio_total_amount > 0
       AND m.refunded > 0
       AND m.paid <= 0
     ORDER BY r.check_in_date, r.id`.execute(db);
  return rows.rows.map((r) => ({ ...r, agreed_total: Number(r.agreed_total), refunded: Number(r.refunded) }));
}
