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
