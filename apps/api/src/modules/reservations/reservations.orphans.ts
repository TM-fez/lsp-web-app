import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';

/**
 * ── Bookings stranded on a unit or guest that was soft-deleted (Round 4, N-1). ───────
 *
 * Before the delete guard (core/integrity/liveBookings.ts) a unit or guest could be removed
 * while bookings still pointed at it. Those bookings still exist; their paid invoices still
 * sit in Finance. This finds them so the OWNER can decide what to do — nothing here is run
 * automatically, and nothing here deletes or re-prices anything.
 *
 * "Stranded" = a non-deleted booking that is either live (not CANCELLED / NO_SHOW /
 * CHECKED_OUT) or still has an open (unpaid) invoice, whose unit or whose guest / billing
 * contact / coordinator has deleted_at set. Cancelled and settled-and-finished history is left
 * out on purpose: it is the intended outcome of a soft delete.
 */

export interface OrphanedBooking {
  reservation_id: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  room_id: string;
  room_code: string | null;
  room_deleted: boolean;
  contact_id: string;
  guest_name: string | null;
  guest_deleted: boolean;
  billing_contact_id: string | null;
  billing_contact_deleted: boolean;
  coordinator_id: string | null;
  coordinator_deleted: boolean;
  /** Σ of PAID receipts, in thebe. */
  paid_amount: number;
  /** Open (ISSUED / PARTIALLY_PAID) invoices, in thebe. */
  open_invoice_amount: number;
}

export async function findOrphanedBookings(db: Kysely<Database>): Promise<OrphanedBooking[]> {
  const res = await sql<OrphanedBooking & { paid_amount: string; open_invoice_amount: string }>`
    SELECT r.id AS reservation_id,
           r.status,
           to_char(r.check_in_date, 'YYYY-MM-DD')  AS check_in_date,
           to_char(r.check_out_date, 'YYYY-MM-DD') AS check_out_date,
           r.room_id,
           rm.code AS room_code,
           (rm.deleted_at IS NOT NULL) AS room_deleted,
           r.contact_id,
           c.name AS guest_name,
           (c.deleted_at IS NOT NULL) AS guest_deleted,
           r.billing_contact_id,
           COALESCE(bc.deleted_at IS NOT NULL, false) AS billing_contact_deleted,
           r.booking_coordinator_id AS coordinator_id,
           COALESCE(co.deleted_at IS NOT NULL, false) AS coordinator_deleted,
           COALESCE((SELECT SUM(i.total_amount) FROM invoices i
                      WHERE i.reservation_id = r.id AND i.deleted_at IS NULL
                        AND i.kind <> 'REFUND' AND i.status = 'PAID'), 0)::text AS paid_amount,
           COALESCE((SELECT SUM(i.total_amount) FROM invoices i
                      WHERE i.reservation_id = r.id AND i.deleted_at IS NULL
                        AND i.kind <> 'REFUND' AND i.status IN ('ISSUED', 'PARTIALLY_PAID')), 0)::text AS open_invoice_amount
      FROM reservations r
      LEFT JOIN rooms rm    ON rm.id = r.room_id
      LEFT JOIN contacts c  ON c.id = r.contact_id
      LEFT JOIN contacts bc ON bc.id = r.billing_contact_id
      LEFT JOIN contacts co ON co.id = r.booking_coordinator_id
     WHERE r.deleted_at IS NULL
       AND (rm.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL
            OR bc.deleted_at IS NOT NULL OR co.deleted_at IS NOT NULL)
       AND (r.status NOT IN ('CANCELLED', 'NO_SHOW', 'CHECKED_OUT')
            OR EXISTS (SELECT 1 FROM invoices i
                        WHERE i.reservation_id = r.id AND i.deleted_at IS NULL
                          AND i.kind <> 'REFUND' AND i.status IN ('ISSUED', 'PARTIALLY_PAID')))
     ORDER BY r.check_in_date, r.id
  `.execute(db);
  return res.rows.map((r) => ({
    ...r,
    paid_amount: Number(r.paid_amount),
    open_invoice_amount: Number(r.open_invoice_amount),
  }));
}

export interface RestoreResult {
  rooms_restored: number;
  contacts_restored: number;
}

/**
 * OPTIONAL fix, owner-triggered only: un-delete the units and guests that stranded bookings
 * point at (deleted_at / deleted_by back to NULL), one audit row each, all in ONE transaction.
 * Idempotent: a second run finds nothing left to restore. It restores the ROW, nothing else —
 * the owner can delete it again once the bookings are cancelled or finished (the delete guard
 * now allows exactly that).
 */
export async function restoreStrandedParents(
  db: Kysely<Database>,
  actorUserId: string
): Promise<RestoreResult> {
  return db.transaction().execute(async (trx) => {
    const stranded = await findOrphanedBookings(trx);
    const roomIds = [...new Set(stranded.filter((s) => s.room_deleted).map((s) => s.room_id))];
    const contactIds = [
      ...new Set(
        stranded.flatMap((s) => [
          s.guest_deleted ? s.contact_id : null,
          s.billing_contact_deleted ? s.billing_contact_id : null,
          s.coordinator_deleted ? s.coordinator_id : null,
        ]).filter((id): id is string => id !== null)
      ),
    ];

    if (roomIds.length) {
      await trx.updateTable('rooms').set({ deleted_at: null, deleted_by: null, updated_by: actorUserId, updated_at: sql`now()` })
        .where('id', 'in', roomIds).execute();
      await trx.insertInto('audit_logs').values(roomIds.map((id) => ({
        user_id: actorUserId, action: 'UPDATE' as const, entity: 'rooms', entity_id: id,
        diff: { deleted_at: null, reason: 'restored by the orphaned-bookings repair: live bookings still point at it' },
      }))).execute();
    }
    if (contactIds.length) {
      await trx.updateTable('contacts').set({ deleted_at: null, deleted_by: null, updated_by: actorUserId, updated_at: sql`now()` })
        .where('id', 'in', contactIds).execute();
      await trx.insertInto('audit_logs').values(contactIds.map((id) => ({
        user_id: actorUserId, action: 'UPDATE' as const, entity: 'contacts', entity_id: id,
        diff: { deleted_at: null, reason: 'restored by the orphaned-bookings repair: live bookings still point at it' },
      }))).execute();
    }
    return { rooms_restored: roomIds.length, contacts_restored: contactIds.length };
  });
}
