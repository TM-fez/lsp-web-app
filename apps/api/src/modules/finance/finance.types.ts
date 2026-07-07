// Financial Cockpit (P4.2) — real-time receivables ("who owes us what, how overdue").
// Receivable = an OPEN invoice (status ISSUED | PARTIALLY_PAID) of kind DEPOSIT or
// BALANCE. REFUND invoices flow the other way (money owed back to the guest) and are
// surfaced separately as `refunds_payable`, never netted into receivables.
//
// Invoices carry no due date, so ageing is measured from the issue date (created_at)
// as of "now". There is also no part-payment amount column — a PARTIALLY_PAID invoice
// counts its full total_amount as outstanding (settle() jumps straight to PAID today).
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
}

export interface FinanceCockpit {
  as_of: string; // ISO timestamp the snapshot was taken
  summary: {
    total_receivable: number; // thebe — open DEPOSIT + BALANCE
    open_invoices: number;
    oldest_days: number;      // age of the oldest open receivable (0 when none)
    refunds_payable: number;  // thebe — open REFUND invoices (we owe the guest)
  };
  aging: AgingBucket[];       // always the four buckets, in order
  by_property: PropertyReceivable[];
  invoices: OutstandingInvoice[]; // outstanding list, oldest first (capped)
}

export interface FinanceQuery {
  // A picked property (active-property narrowing), optional.
  propertyId?: string;
  // Access scope: null = no restriction (admin); array = the caller's properties.
  accessiblePropertyIds?: string[] | null;
}
