import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import { AppError } from '../errors/AppError.js';

/**
 * ── What stops a unit or a guest being removed (Round 4, N-1). ───────────────────────
 *
 * Soft-deleting a unit or a guest used to succeed whatever was booked against it. The
 * bookings stayed in the database — and their PAID invoices stayed in Finance — but the
 * booking itself dropped off the board (its unit or guest was "gone"), so a guest's arrival
 * silently disappeared while their money did not.
 *
 * A removal is refused (409) while any of these remain:
 *   • a LIVE booking — anything not CANCELLED / NO_SHOW / CHECKED_OUT (PENDING, CONFIRMED,
 *     CHECKED_IN, an unclaimed Booking.com BLOCK). It holds dates or is a guest in the house.
 *   • an UNPAID invoice — an open (ISSUED / PARTIALLY_PAID) invoice on any booking, even a
 *     finished one: someone still owes the business money and needs the guest/unit to chase it.
 * Cancelled, no-show and checked-out-and-settled history does NOT block (soft delete, as before):
 * those stay readable — the list queries LEFT JOIN, and a settled stay owes nothing.
 *
 * Deliberately a status/invoice question only: it never decides whether a room is free
 * (invariant 7 — the money axis stays out of availability); it only decides whether a row may
 * be hidden.
 */

const ENDED = ['CANCELLED', 'NO_SHOW', 'CHECKED_OUT'] as const;

export interface DeleteBlockers {
  /** Live bookings against the unit / guest. */
  liveBookings: number;
  /** Of those, how many already have money received (a PAID receipt). */
  liveBookingsWithPayments: number;
  /** Open (unpaid / part-paid) invoices on any non-deleted booking, finished or not. */
  openInvoices: number;
}

export type BlockerSubject = { kind: 'room'; id: string } | { kind: 'contact'; id: string };

/**
 * Count what blocks removing the subject. Run it INSIDE the deleting transaction, after
 * locking the subject's row FOR UPDATE (see lockForDelete) — a new booking takes a
 * FOR KEY SHARE lock on that row through its foreign key, so it either lands before the
 * lock is granted (and is counted here) or waits until the removal has committed.
 */
export async function countDeleteBlockers(
  trx: Kysely<Database>,
  subject: BlockerSubject
): Promise<DeleteBlockers> {
  // A guest can be the booker, the billed party or the coordinator; hiding any of them
  // breaks the booking's display, so every role counts.
  const belongs =
    subject.kind === 'room'
      ? sql`r.room_id = ${subject.id}`
      : sql`(r.contact_id = ${subject.id} OR r.billing_contact_id = ${subject.id} OR r.booking_coordinator_id = ${subject.id})`;

  const row = await sql<{ live: string; live_paid: string; open_invoices: string }>`
    SELECT
      COUNT(*) FILTER (WHERE r.status NOT IN (${sql.join([...ENDED])}))::text AS live,
      COUNT(*) FILTER (
        WHERE r.status NOT IN (${sql.join([...ENDED])})
          AND EXISTS (SELECT 1 FROM invoices i
                       WHERE i.reservation_id = r.id AND i.deleted_at IS NULL
                         AND i.kind <> 'REFUND' AND i.status = 'PAID')
      )::text AS live_paid,
      COALESCE(SUM((SELECT COUNT(*) FROM invoices i
                     WHERE i.reservation_id = r.id AND i.deleted_at IS NULL
                       AND i.kind <> 'REFUND' AND i.status IN ('ISSUED', 'PARTIALLY_PAID'))), 0)::text AS open_invoices
    FROM reservations r
    WHERE ${belongs} AND r.deleted_at IS NULL
  `.execute(trx);

  const r = row.rows[0]!;
  return {
    liveBookings: Number(r.live),
    liveBookingsWithPayments: Number(r.live_paid),
    openInvoices: Number(r.open_invoices),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Plain English for the 409. `null` when nothing blocks. */
export function describeDeleteBlockers(
  subject: 'unit' | 'guest',
  b: DeleteBlockers
): string | null {
  if (b.liveBookings === 0 && b.openInvoices === 0) return null;

  const parts: string[] = [];
  if (b.liveBookings > 0) {
    const paid =
      b.liveBookingsWithPayments > 0
        ? ` (${b.liveBookingsWithPayments === b.liveBookings ? 'all' : b.liveBookingsWithPayments} with money already received)`
        : '';
    parts.push(`${plural(b.liveBookings, 'active or upcoming booking', 'active or upcoming bookings')}${paid}`);
  }
  if (b.openInvoices > 0) {
    parts.push(plural(b.openInvoices, 'unpaid invoice', 'unpaid invoices'));
  }
  const what = subject === 'unit' ? 'this unit' : 'this guest';
  return (
    `You can’t remove ${what} yet — it still has ${parts.join(' and ')}. ` +
    `Cancel or finish the booking${b.liveBookings === 1 ? '' : 's'} and settle what is owed first; ` +
    `removing ${what} now would hide ${b.liveBookings > 0 ? 'bookings' : 'invoices'} that still matter.`
  );
}

/** Lock the subject's row so a booking cannot be created against it while we decide. */
export async function lockForDelete(trx: Kysely<Database>, subject: BlockerSubject): Promise<boolean> {
  const table = subject.kind === 'room' ? 'rooms' : 'contacts';
  const row = await trx
    .selectFrom(table)
    .select('id')
    .where('id', '=', subject.id)
    .where('deleted_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  return Boolean(row);
}

/** Lock, count, refuse. Returns false when the row is already gone (caller 404s). */
export async function assertCanDelete(
  trx: Kysely<Database>,
  subject: BlockerSubject
): Promise<boolean> {
  if (!(await lockForDelete(trx, subject))) return false;
  const message = describeDeleteBlockers(
    subject.kind === 'room' ? 'unit' : 'guest',
    await countDeleteBlockers(trx, subject)
  );
  if (message) throw AppError.conflict(message);
  return true;
}
