import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';

/**
 * ── The MONEY axis of a booking: the single home of its arithmetic. ───────────────────
 *
 * Everything here reads INVOICES and nothing else, and nothing here may ever be used to
 * decide whether a booking holds a room (CLAUDE.md invariant 7): availability, overlap
 * and channel-export queries must not import this file. `money-axis-invariant.test.ts`
 * asserts it.
 *
 * Why it is a shared module and not a method on one repository: "how much has this
 * booking paid" used to live in ReservationsRepository, and the payment, settle, refund
 * and reconcile paths all need the SAME answer INSIDE their own transaction. A second
 * copy of the formula is how D01 happened (two definitions of "blocked" drifting apart).
 */

/** An invoice that is still owed — the receivable. VOID / PAID / REFUNDED are not. */
export const OPEN_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID'] as const;

/** Statuses from which no more money is owed or expected on the booking. */
export const TERMINAL_RESERVATION_STATUSES = ['CANCELLED', 'NO_SHOW'] as const;

/**
 * How much money has actually arrived against each booking, in thebe.
 *
 * ⚠️ The refund subtlety, which the obvious query gets backwards: refundInvoice() marks
 * the ORIGINAL invoice 'REFUNDED' and inserts a SEPARATE positive row with
 * kind='REFUND', status='PAID'. Filtering on status='PAID' alone would drop the original
 * from the positive side while keeping the refund on the negative side: a P1,000 booking
 * refunded P300 would read as −P300 paid instead of P700. A REFUNDED invoice was still
 * paid — the money did arrive — so both statuses count, and the REFUND row takes it out.
 */
export async function paidToDate(
  db: Kysely<Database>,
  reservationIds: string[]
): Promise<Map<string, number>> {
  const paid = new Map<string, number>();
  if (reservationIds.length === 0) return paid;

  const rows = await db
    .selectFrom('invoices')
    .select(['reservation_id'])
    .select(
      sql<string>`COALESCE(SUM(CASE WHEN kind = 'REFUND' THEN -total_amount ELSE total_amount END), 0)`.as('paid')
    )
    .where('reservation_id', 'in', reservationIds)
    .where('deleted_at', 'is', null)
    .where('status', 'in', ['PAID', 'REFUNDED'])
    .groupBy('reservation_id')
    .execute();

  for (const row of rows) {
    // SUM() comes back as a string from pg (bigint), so Number() it here rather than
    // letting a string leak into money arithmetic (invariant 1: integer thebe).
    if (row.reservation_id) paid.set(row.reservation_id, Number(row.paid));
  }
  return paid;
}

export interface LockedReservation {
  id: string;
  status: string;
  room_id: string;
  folio_total_amount: number | null;
  folio_currency: string;
  /** Check-in as a plain YYYY-MM-DD — never a JS Date, which shifts a day with the server TZ. */
  check_in_day: string;
}

/**
 * Take the booking's row lock and return it. EVERY writer of money against a booking
 * does this first, inside its own transaction; the second of two parallel writers
 * waits here and then reads the first one's committed result, which is what stops two
 * simultaneous payments both passing an "is there anything outstanding" check.
 *
 * FOR NO KEY UPDATE rather than FOR UPDATE: it still excludes other writers (and other
 * lockers), but does not block the FOREIGN-KEY checks that inserting an invoice, hold or
 * occupancy row against the reservation performs — so the lock holder's own inserts, and
 * unrelated writers, are never stalled by it.
 *
 * Returns undefined for a missing or soft-deleted booking (invariant 5).
 */
export async function lockReservation(
  trx: Kysely<Database>,
  reservationId: string
): Promise<LockedReservation | undefined> {
  const row = await trx
    .selectFrom('reservations')
    .select([
      'id',
      'status',
      'room_id',
      'folio_total_amount',
      'folio_currency',
      sql<string>`to_char(check_in_date, 'YYYY-MM-DD')`.as('check_in_day'),
    ])
    .where('id', '=', reservationId)
    .where('deleted_at', 'is', null)
    .forNoKeyUpdate()
    .executeTakeFirst();
  return row as LockedReservation | undefined;
}

/**
 * What the booking was agreed at, in thebe — or null when nothing says.
 *
 * The frozen folio total wins (migration 067). Failing that, the invoices already raised
 * ARE the agreement (the same reconstruction migration 067 used): the sum of every
 * non-void, non-refund, non-deleted invoice. Null means "never priced, never invoiced" —
 * the caller must not invent a number.
 */
export async function agreedTotal(
  db: Kysely<Database>,
  reservation: Pick<LockedReservation, 'id' | 'folio_total_amount'>
): Promise<number | null> {
  if (reservation.folio_total_amount != null) return reservation.folio_total_amount;
  const row = await db
    .selectFrom('invoices')
    .select(sql<string | null>`SUM(total_amount)`.as('total'))
    .where('reservation_id', '=', reservation.id)
    .where('deleted_at', 'is', null)
    .where('kind', '<>', 'REFUND')
    .where('status', '<>', 'VOID')
    .executeTakeFirst();
  return row?.total == null ? null : Number(row.total);
}

/**
 * Thebe as prose for an error message — "P1,234.50". Integer arithmetic only (invariant 1);
 * the UI edge has formatMoney, but an AppError message is its own edge and must not
 * round-trip through a float.
 */
export function describeThebe(thebe: number): string {
  const sign = thebe < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(thebe));
  const whole = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}P${whole}.${String(abs % 100).padStart(2, '0')}`;
}
