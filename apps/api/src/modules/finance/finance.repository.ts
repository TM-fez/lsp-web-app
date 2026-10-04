import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import { invoicePropertyIdSql, invoiceVisibleInProperty } from '../../core/scope/invoiceProperty.js';
import { propertyToday } from '../../core/time.js';
import type { AgingBucketKey, FinanceQuery, HeldOnCancelledRow } from './finance.types.js';

// ONE property rule, shared with the Invoices list (core/scope/invoiceProperty.ts).
//
// The cockpit used to resolve an invoice's property through reservation → room only, and
// for a non-admin DROPPED every invoice it could not attribute — while the Invoices list
// walked a longer chain (via the hold too) and showed unattributed invoices everywhere.
// Same invoices, two totals, depending on screen and on who was asking. Now both screens
// ask the same question: "is this invoice visible in the active property?" — it resolves
// there, or it resolves nowhere (house-wide, shown in every property).
const inProperty = (propertyId: string) => sql`AND ${invoiceVisibleInProperty(propertyId, 'i')}`;

// Whole-number days since issue, "as of now" — the ageing clock.
const AGE_DAYS = sql`floor(extract(epoch from (now() - i.created_at)) / 86400)`;

// Open = unpaid. VOID/PAID/REFUNDED are settled and drop out of the ledger.
const OPEN = sql`i.status IN ('ISSUED','PARTIALLY_PAID') AND i.deleted_at IS NULL`;

// Past its due date, by the PROPERTY's calendar (Africa/Gaborone), never the server's.
const PAST_DUE = sql`i.due_date < ${propertyToday()}`;

// Name the property an invoice resolves to (NULL = unattributed) for the by-property split.
const PROPERTY_CHAIN = sql`
  LEFT JOIN properties p ON p.id = ${invoicePropertyIdSql('i')}`;

interface SummaryRow {
  total_receivable: string | number | null;
  open_invoices: string | number | null;
  oldest_days: string | number | null;
  refunds_payable: string | number | null;
  overdue_amount: string | number | null;
  overdue_count: string | number | null;
}
interface AgingRow { bucket: AgingBucketKey; amount: string | number | null; count: string | number | null }
interface PropRow { property_id: string | null; property_name: string | null; amount: string | number | null; count: string | number | null }
interface InvoiceRow {
  id: string; number: string; kind: 'DEPOSIT' | 'BALANCE'; status: 'ISSUED' | 'PARTIALLY_PAID';
  total_amount: string | number; currency: string; bill_to_name: string | null;
  property_id: string | null; property_name: string | null; created_at: Date; days_outstanding: string | number;
  due_date: string | null; days_overdue: string | number | null;
}

export class FinanceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // Headline totals in one pass: receivables (DEPOSIT+BALANCE) plus the refund
  // liability (REFUND), split with FILTER so a single scan does both.
  async summary(q: FinanceQuery): Promise<SummaryRow> {
    const r = await sql<SummaryRow>`
      SELECT
        COALESCE(SUM(i.total_amount) FILTER (WHERE i.kind IN ('DEPOSIT','BALANCE')), 0) AS total_receivable,
        COUNT(*) FILTER (WHERE i.kind IN ('DEPOSIT','BALANCE')) AS open_invoices,
        COALESCE(MAX(${AGE_DAYS}) FILTER (WHERE i.kind IN ('DEPOSIT','BALANCE')), 0) AS oldest_days,
        COALESCE(SUM(i.total_amount) FILTER (WHERE i.kind IN ('DEPOSIT','BALANCE') AND ${PAST_DUE}), 0) AS overdue_amount,
        COUNT(*) FILTER (WHERE i.kind IN ('DEPOSIT','BALANCE') AND ${PAST_DUE}) AS overdue_count
      FROM invoices i
      WHERE ${OPEN}
        ${inProperty(q.propertyId)}
    `.execute(this.db);
    return { ...r.rows[0]!, refunds_payable: await this.refundsPayable(q) };
  }

  /**
   * (Re-test round 3) What the house owes guests back: on each live booking, money paid
   * beyond the agreed total (a stay shortened after payment) — the folio's credit_amount.
   * This used to sum OPEN refund invoices, but a refund is recorded already paid
   * (a credit note is born PAID), so the figure was always 0.
   */
  private async refundsPayable(q: FinanceQuery): Promise<number> {
    const r = await sql<{ owed: string | number | null }>`
      WITH paid AS (
        SELECT reservation_id,
               SUM(CASE WHEN kind = 'REFUND' THEN -total_amount ELSE total_amount END) AS amount
          FROM invoices
         WHERE status IN ('PAID','REFUNDED') AND deleted_at IS NULL AND reservation_id IS NOT NULL
         GROUP BY reservation_id
      )
      SELECT COALESCE(SUM(GREATEST(0, p.amount - r.folio_total_amount)), 0) AS owed
        FROM reservations r
        JOIN paid p ON p.reservation_id = r.id
        ${q.propertyId ? sql`JOIN rooms rm ON rm.id = r.room_id JOIN buildings b ON b.id = rm.building_id` : sql``}
       WHERE r.deleted_at IS NULL
         AND r.folio_total_amount IS NOT NULL
         AND r.status NOT IN ('CANCELLED','NO_SHOW')
         ${q.propertyId ? sql`AND b.property_id = ${q.propertyId}` : sql``}
    `.execute(this.db);
    return Number(r.rows[0]?.owed ?? 0);
  }

  // Receivables split into ageing buckets by issue age. Only the non-empty buckets
  // come back; the service fills the fixed four-bucket shape.
  async aging(q: FinanceQuery): Promise<AgingRow[]> {
    const r = await sql<AgingRow>`
      SELECT
        CASE
          WHEN ${AGE_DAYS} <= 30 THEN '0-30'
          WHEN ${AGE_DAYS} <= 60 THEN '31-60'
          WHEN ${AGE_DAYS} <= 90 THEN '61-90'
          ELSE '90+'
        END AS bucket,
        SUM(i.total_amount) AS amount,
        COUNT(*) AS count
      FROM invoices i
      WHERE ${OPEN} AND i.kind IN ('DEPOSIT','BALANCE')
        ${inProperty(q.propertyId)}
      GROUP BY 1
    `.execute(this.db);
    return r.rows;
  }

  // Outstanding receivable per property (biggest debtor property first).
  async byProperty(q: FinanceQuery): Promise<PropRow[]> {
    const r = await sql<PropRow>`
      SELECT p.id AS property_id, p.name AS property_name,
             SUM(i.total_amount) AS amount, COUNT(*) AS count
      FROM invoices i
      ${PROPERTY_CHAIN}
      WHERE ${OPEN} AND i.kind IN ('DEPOSIT','BALANCE')
        ${inProperty(q.propertyId)}
      GROUP BY 1, 2
      ORDER BY amount DESC
    `.execute(this.db);
    return r.rows;
  }

  // The drill-down list — oldest first, so the front desk chases the stalest debts.
  // bill_to matches the invoice document: the billing contact when set, else the guest.
  // Capped; summary.open_invoices carries the true count so the screen can say
  // "showing 200 of 340" instead of presenting a truncated list as the whole debt.
  async outstanding(q: FinanceQuery, limit = 200): Promise<InvoiceRow[]> {
    const r = await sql<InvoiceRow>`
      SELECT i.id, i.number, i.kind, i.status, i.total_amount, i.currency,
             COALESCE(bc.name, c.name) AS bill_to_name,
             p.id AS property_id, p.name AS property_name,
             i.created_at,
             ${AGE_DAYS}::int AS days_outstanding,
             to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
             CASE WHEN ${PAST_DUE} THEN (${propertyToday()} - i.due_date) ELSE 0 END AS days_overdue
      FROM invoices i
      LEFT JOIN reservations rsv ON rsv.id = i.reservation_id
      LEFT JOIN contacts c ON c.id = rsv.contact_id
      LEFT JOIN contacts bc ON bc.id = rsv.billing_contact_id
      ${PROPERTY_CHAIN}
      WHERE ${OPEN} AND i.kind IN ('DEPOSIT','BALANCE')
        ${inProperty(q.propertyId)}
      ORDER BY i.created_at ASC
      LIMIT ${limit}
    `.execute(this.db);
    return r.rows;
  }

  /**
   * (Round 4) Bookings that were cancelled or no-showed but still hold the guest's money.
   *
   * "Held" = paid in minus refunds already given (the same arithmetic as the folio's
   * paid-to-date: PAID/REFUNDED invoices count, a REFUND invoice takes money back out).
   * Nothing is refunded or released here — the point is that retained money is never
   * silent. Scoped to the active property through the booking's unit.
   */
  async heldOnCancelled(q: FinanceQuery, limit = 200): Promise<HeldOnCancelledRow[]> {
    const r = await sql<HeldOnCancelledRow>`
      WITH paid AS (
        SELECT reservation_id, MAX(currency) AS currency,
               SUM(CASE WHEN kind = 'REFUND' THEN -total_amount ELSE total_amount END) AS amount
          FROM invoices
         WHERE status IN ('PAID','REFUNDED') AND deleted_at IS NULL AND reservation_id IS NOT NULL
         GROUP BY reservation_id
      )
      SELECT r.id AS reservation_id, c.name AS guest_name, rm.code AS room_code, r.status::text AS status,
             to_char(r.check_in_date, 'YYYY-MM-DD') AS check_in_date,
             to_char(r.check_out_date, 'YYYY-MM-DD') AS check_out_date,
             p.currency, p.amount::bigint AS received,
             to_char(r.updated_at AT TIME ZONE 'Africa/Gaborone', 'YYYY-MM-DD') AS cancelled_on
        FROM reservations r
        JOIN paid p ON p.reservation_id = r.id
        JOIN rooms rm ON rm.id = r.room_id
        JOIN buildings b ON b.id = rm.building_id
        LEFT JOIN contacts c ON c.id = r.contact_id
       WHERE r.deleted_at IS NULL
         AND r.status IN ('CANCELLED','NO_SHOW')
         AND p.amount > 0
         AND b.property_id = ${q.propertyId}
       ORDER BY p.amount DESC, r.updated_at DESC
       LIMIT ${limit}
    `.execute(this.db);
    return r.rows.map((row) => ({ ...row, received: Number(row.received) }));
  }
}
