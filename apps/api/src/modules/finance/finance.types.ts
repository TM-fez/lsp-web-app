// Financial Cockpit (P4.2) — real-time receivables ("who owes us what, how overdue").
// Receivable = an OPEN invoice (status ISSUED | PARTIALLY_PAID) of kind DEPOSIT or
// BALANCE. REFUND invoices flow the other way (money owed back to the guest) and are
// surfaced separately as `refunds_payable`, never netted into receivables.
//
// Ageing buckets are measured from the issue date (created_at) as of "now"; OVERDUE is a
// separate question, answered from invoices.due_date (migration 071) against the
// property's calendar day. A PARTIALLY_PAID invoice is an open invoice on a booking that
// has received money; its total_amount is already only what is STILL owed (the invoice is
// re-sized on every payment — invoices.receivable.ts), so summing totals is correct.
// All amounts are thebe (100 = 1 BWP).

export type AgingBucketKey = '0-30' | '31-60' | '61-90' | '90+';

export interface AgingBucket {
  bucket: AgingBucketKey;
  amount: number; // thebe
  count: number;
}

export interface PropertyReceivable {
  property_id: string | null;
  property_name: string; // 'Unattributed' when the invoice has no property chain
  amount: number;        // thebe
  count: number;
}

export interface OutstandingInvoice {
  id: string;
  number: string;
  kind: 'DEPOSIT' | 'BALANCE';
  status: 'ISSUED' | 'PARTIALLY_PAID';
  total_amount: number;  // thebe
  currency: string;
  bill_to_name: string | null; // billing contact when assigned, else the guest
  property_id: string | null;
  property_name: string | null;
  created_at: string;    // ISO
  days_outstanding: number;
  due_date: string | null; // YYYY-MM-DD, Africa/Gaborone
  days_overdue: number;    // 0 when not past due
}

export interface FinanceCockpit {
  as_of: string; // ISO timestamp the snapshot was taken
  summary: {
    total_receivable: number; // thebe — open DEPOSIT + BALANCE
    open_invoices: number;
    oldest_days: number;      // age of the oldest open receivable (0 when none)
    refunds_payable: number;  // thebe — paid beyond the agreed total on live bookings (we owe the guest)
    overdue_amount: number;   // thebe — the part of total_receivable past its due date
    overdue_count: number;
  };
  aging: AgingBucket[];       // always the four buckets, in order
  by_property: PropertyReceivable[];
  invoices: OutstandingInvoice[]; // outstanding list, oldest first (capped)
}

export interface FinanceQuery {
  // The ACTIVE property (X-Property-Id, validated by requireActiveProperty). Required:
  // the cockpit shows one property's books, the same scope as the Invoices list. (It used
  // to default to "everything this user can reach", so the two screens disagreed.)
  propertyId: string;
}

/** One cancelled / no-show booking that still holds guest money (Round 4). */
export interface HeldOnCancelledRow {
  reservation_id: string;
  guest_name: string | null;
  room_code: string | null;
  status: 'CANCELLED' | 'NO_SHOW';
  check_in_date: string;   // YYYY-MM-DD
  check_out_date: string;
  currency: string;
  received: number;        // thebe — paid in, net of refunds already given
  cancelled_on: string;    // YYYY-MM-DD, when the booking last changed (property day)
}

export interface HeldOnCancelled {
  as_of: string;
  total_held: number;      // thebe — sum of `received`
  count: number;
  rows: HeldOnCancelledRow[];
  /** Plain-English reminder that nothing here is refunded automatically. */
  note: string;
}
