// Accounts / Reports. Costs are maintenance/contractor spend (approved) plus the
// operating-expenses ledger. All amounts are thebe (100 = 1 BWP).
//
// Revenue has TWO bases, and which one a figure is on is never left implicit:
//
//   ACCRUAL (default, G30) — earned per night from `revenue_recognition`. Revenue
//     belongs to the month the night was slept in, whenever the money arrives.
//   CASH — received, summed from PAID invoices by payment date. What actually landed.
//
// The P&L used to be a HYBRID: cash revenue against accrual costs (operating_expenses
// .incurred_on and maintenance_work_orders.opened_at were already accrual). The two
// sides of the same month were on different clocks, which is why the monthly margin
// did not read correctly. Owner decision 2026-09-07: LSP is the book of record for
// revenue, so ACCRUAL is the default and the cash basis stays reachable for
// reconciliation.

/**
 * Which clock a revenue figure is on. Never inferred — every response says which it
 * used, because the same month has two legitimate and different answers.
 */
export type RevenueBasis = 'ACCRUAL' | 'CASH';

export interface ReportWindow {
  /** Defaults to ACCRUAL (owner decision 2026-09-07). */
  basis?: RevenueBasis;
  from?: string;    // YYYY-MM-DD inclusive (defaults to 11 months before `to`)
  to?: string;      // YYYY-MM-DD inclusive (defaults to today)
  propertyId?: string;
  // Access scope: null = no restriction (admin); array = the caller's properties.
  accessiblePropertyIds?: string[] | null;
}

/**
 * How far the accrual figures can be trusted, carried on every ACCRUAL response.
 *
 * Two separate honesty problems, and neither may be left to a footnote someone
 * remembers to add:
 *
 *   `reconstructed` — revenue whose stay total was never frozen, so the backfill
 *     priced it at TODAY's rates (total_source PRICED). Rate plans have no effective
 *     dating, so those figures are a reconstruction, not a recovery.
 *   `unrecognised_stays` — stays inside the window that are earning but have no
 *     ledger rows at all. Normally zero. Non-zero means the backfill has not been run
 *     (or cannot price them), and the revenue figure is UNDERSTATED by whatever they
 *     were worth. Without this a missing ledger is indistinguishable from a bad month.
 */
export interface AccrualDisclosure {
  reconstructed: number;        // thebe, a subset of revenue
  reconstructed_pct: number;    // of revenue (1dp), 0 when there is no revenue
  unrecognised_stays: number;   // count of earning stays with no live ledger rows
}

export interface PnlSummary {
  from: string;
  to: string;
  revenue_basis: RevenueBasis;
  revenue: number;
  /** Present on ACCRUAL responses only — see AccrualDisclosure. */
  disclosure?: AccrualDisclosure;
  maintenance_cost: number;
  operating_expenses: number;
  total_cost: number;
  net: number;
  margin_pct: number;            // net / revenue * 100 (1dp), 0 when no revenue
  vat_output: number;            // VAT collected on PAID invoices (thebe) — BURS output VAT
  reservations: number;          // confirmed+ stays overlapping the window
  room_nights_booked: number;
  room_nights_available: number;
  occupancy_pct: number;         // booked / available * 100 (1dp)
}

export interface MonthlyPoint {
  month: string;                 // YYYY-MM
  revenue: number;
  maintenance_cost: number;
  operating_expenses: number;
  net: number;
}

export interface PropertyPnl {
  property_id: string | null;
  property_name: string;         // 'Company-wide' for unattributed costs
  revenue: number;
  maintenance_cost: number;
  operating_expenses: number;
  net: number;
  occupancy_pct: number | null;  // null where there are no rooms (e.g. company-wide)
}

export interface ReportsResponse {
  summary: PnlSummary;
  monthly: MonthlyPoint[];
  by_property: PropertyPnl[];
}

// ── Operational Cockpit (P4.3) — occupancy + comparative trends ────────────────
// Occupancy over completed calendar months only (the current partial month is
// excluded so every point is well-defined). The "big three" hospitality metrics:
// occupancy, ADR (revenue / booked nights) and RevPAR (revenue / available
// nights). Revenue is recognised (PAID invoices), same basis as the P&L. Room
// counts use the current active estate applied across the window (a simplification
// the P&L already makes). All money is thebe.

export interface OperationsWindow {
  months?: number;   // trailing completed months (default 12, clamped 1..24)
  propertyId?: string;
  accessiblePropertyIds?: string[] | null;
}

export interface OpsKpis {
  occupancy_pct: number;
  room_nights_booked: number;
  room_nights_available: number;
  reservations: number;
  revenue: number;   // thebe (recognised)
  adr: number;       // thebe — revenue / booked nights
  revpar: number;    // thebe — revenue / available nights
}

export interface OpsMonthlyPoint {
  month: string;     // YYYY-MM
  occupancy_pct: number;
  room_nights_booked: number;
  room_nights_available: number;
  reservations: number;
  revenue: number;   // thebe
  adr: number;       // thebe
}

export interface OpsPropertyRow {
  property_id: string | null;
  property_name: string;
  occupancy_pct: number | null;  // null where there are no rooms
  room_nights_booked: number;
  reservations: number;
}

export interface OpsDeltas {
  occupancy_pts: number;             // percentage-point change vs prior year
  reservations_pct: number | null;   // null when the prior period had none
  adr_pct: number | null;
  revpar_pct: number | null;
  revenue_pct: number | null;
}

export interface OperationsResponse {
  window: { from: string; to: string; months: number };
  summary: OpsKpis;
  previous: OpsKpis & { from: string; to: string };  // same months, prior year
  deltas: OpsDeltas;
  monthly: OpsMonthlyPoint[];
  by_property: OpsPropertyRow[];
}

// ── Owner statements — per third-party-landlord monthly payout ────────────────
// LSP manages units for outside landlords (rooms.ownership='LANDLORD', migration
// 054). For a date window this composes the money we already track into a payout
// statement per landlord: recognised revenue (PAID invoices) and booked
// occupancy per owned unit, less the repair cost charged to that owner, netting
// to what LSP owes them. Money is thebe; grouping key is the free-text
// landlord_name (unnamed LANDLORD units bucket under a single fallback label).

export interface OwnerStatementWindow {
  from?: string;   // YYYY-MM-DD inclusive (defaults to the trailing 12 months)
  to?: string;     // YYYY-MM-DD inclusive
  propertyId?: string;
  accessiblePropertyIds?: string[] | null;
}

export interface OwnerUnitLine {
  room_id: string;
  room_code: string | null;
  room_name: string;
  property_id: string | null;
  property_name: string;         // 'Company-wide' when a unit has no property
  revenue: number;               // thebe — recognised (PAID invoices)
  nights: number;                // booked room-nights in the window
  occupancy_pct: number;         // nights / days-in-window * 100 (1dp)
  maintenance_cost: number;      // thebe — approved repair cost charged to owner
  net: number;                   // revenue - maintenance_cost
}

export interface OwnerStatement {
  landlord_name: string;
  landlord_phone: string | null; // first known contact across the owner's units
  unit_count: number;
  revenue: number;
  nights: number;
  room_nights_available: number; // unit_count * days-in-window
  occupancy_pct: number;         // nights / available * 100 (1dp)
  maintenance_cost: number;
  net: number;                   // the payout owed to the landlord
  units: OwnerUnitLine[];
}

export interface OwnersResponse {
  from: string;
  to: string;
  owners: OwnerStatement[];      // best net first
  totals: {
    landlords: number;
    units: number;
    revenue: number;
    maintenance_cost: number;
    net: number;
  };
}


// ── Earned vs received (G30) — the reconciliation the accrual switch makes necessary ─
//
// Once revenue is recognised per night, "what did September earn" and "what did
// September collect" are different questions with different answers, and the gap
// between them is the point rather than an error. A pay-later guest earns in
// September and pays in October; the September row shows the earning, the October row
// shows the cash, and the running difference is what the house is owed for nights it
// has already provided.
//
// This is the accrual receivable, at the month level. Invoice-level debtor ageing —
// who owes what and for how long — stays on /finance, which reads invoices directly.

export interface EarnedReceivedPoint {
  month: string;      // YYYY-MM
  earned: number;     // thebe, gross — nights slept in this month
  received: number;   // thebe, gross — payments that landed in this month
  difference: number; // earned - received; positive = earned but not yet collected
  reconstructed: number; // thebe, the part of `earned` priced at today's rates
}

export interface RevenueReconciliation {
  from: string;
  to: string;
  monthly: EarnedReceivedPoint[];
  totals: {
    earned: number;
    received: number;
    difference: number;
    /** VAT inside `earned` — the accrual counterpart of the P&L's cash vat_output. */
    earned_tax: number;
  };
  disclosure: AccrualDisclosure;
}
