// Accounts / Reports: revenue is recognised from PAID invoices (deposits at booking,
// balances at check-out); costs are maintenance/contractor spend (approved) plus the
// operating-expenses ledger. All amounts are thebe (100 = 1 BWP).

export interface ReportWindow {
  from?: string;    // YYYY-MM-DD inclusive (defaults to 11 months before `to`)
  to?: string;      // YYYY-MM-DD inclusive (defaults to today)
  propertyId?: string;
  // Access scope: null = no restriction (admin); array = the caller's properties.
  accessiblePropertyIds?: string[] | null;
}

export interface PnlSummary {
  from: string;
  to: string;
  revenue: number;
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
