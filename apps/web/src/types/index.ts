// Domain types mirroring the LSP API responses (JSON — dates arrive as strings).

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  role: string;
  permissions: string[];
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

// A property the signed-in user may enter (from /auth/me) — drives the picker.
export interface MyProperty {
  id: string;
  name: string;
  code: string | null;
}

export interface MeResponse {
  id: string;
  email: string;
  role: string;
  permissions: string[];
  properties: MyProperty[];
}

export type RoomStatus = 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
export type HousekeepingStatus = 'READY' | 'DIRTY' | 'CLEANING' | 'INSPECTED';
export type HousekeepingTaskStatus = 'OPEN' | 'CLEANING' | 'INSPECTED' | 'DONE';
// BLOCKED = a night imported from an OTA calendar (channel sync). Importer-owned,
// never user-set — read-only in every form, shown as "OTA block".
export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'BLOCKED';
export type ReservationSource = 'DIRECT' | 'WEBSITE' | 'WALK_IN' | 'PHONE' | 'EMAIL' | 'BOOKING_COM' | 'CORPORATE' | 'OTHER';
export type UnitType = 'STANDARD' | 'DELUXE' | 'SUITE' | 'CONFERENCE' | 'CUSTOM';
export type PaymentMethod = 'CARD' | 'MOBILE_MONEY' | 'EFT' | 'CASH' | 'CORPORATE_CREDIT';
export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST';
export type LeadSource = 'WHATSAPP' | 'WALK_IN' | 'BOOKING_COM' | 'WEBSITE' | 'REFERRAL' | 'CORPORATE' | 'OTHER';

// ── Cockpit board ─────────────────────────────────────────────────────────────

export interface CockpitUnit {
  room_id: string;
  name: string;
  code: string;
  type: UnitType;
  status: RoomStatus;
  housekeeping_status: HousekeepingStatus;
  capacity: number;
  floor?: number | null;
  building_id?: string | null;
  building_name?: string | null;
  property_id?: string | null;
  property_name?: string | null;
  guest_name: string | null;
  occupancy_id: string | null;
  reservation_id: string | null;
  check_out_date: string | null;
}

export interface CockpitGuestCard {
  reservation_id: string;
  occupancy_id: string | null;
  contact_id: string;
  guest_name: string;
  room_id: string;
  room_name: string;
  room_code: string;
  check_in_date: string;
  check_out_date: string;
  status: ReservationStatus;
  source: ReservationSource;
}

export interface HousekeepingQueueItem {
  task_id: string;
  room_id: string;
  room_name: string;
  room_code: string;
  task_status: HousekeepingTaskStatus;
  housekeeping_status: HousekeepingStatus;
  assigned_to: string | null;
  occupancy_id: string | null;
  opened_at: string;
  started_at: string | null;
  inspected_at: string | null;
}

export interface CockpitBoard {
  date: string;
  units: CockpitUnit[];
  arrivals: CockpitGuestCard[];
  in_house: CockpitGuestCard[];
  departures: CockpitGuestCard[];
  housekeeping_queue: HousekeepingQueueItem[];
}

// ── Commercial flow entities ──────────────────────────────────────────────────

export type ContactType = 'individual' | 'company';

export interface Contact {
  id: string;
  type: ContactType;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Whose unit this is — Lifestyle's own or a third-party landlord's. Drives the
// repair-cost owner attribution in maintenance + expenses.
export type RoomOwnership = 'LIFESTYLE' | 'LANDLORD';

export interface Room {
  id: string;
  name: string;
  code: string;
  type: UnitType;
  status: RoomStatus;
  housekeeping_status: HousekeepingStatus;
  capacity: number;
  notes?: string | null;
  ownership: RoomOwnership;
  landlord_name?: string | null;
  landlord_phone?: string | null;
  // Multi-property (list endpoint enriches these via building → property).
  building_id?: string | null;
  floor?: number | null;
  building_name?: string | null;
  property_id?: string | null;
  property_name?: string | null;
  // Channel sync (present on the by-id endpoint, not the list): the unguessable
  // export-feed token and the Booking.com calendar URL the importer pulls from.
  ical_token?: string;
  booking_ical_url?: string | null;
  // Guest self check-in (P5.1): the per-unit token embedded in the in-apartment QR.
  guest_qr_token?: string;
}

export type RoomCreateStatus = 'AVAILABLE' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

export interface Building {
  id: string;
  property_id: string;
  name: string;
  code: string | null;
  active: boolean;
  units: number;
}

export interface Property {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
  active: boolean;
  units: number;
  buildings: Building[];
}

export interface RatePlan {
  id: string;
  unit_type: UnitType;
  name: string;
  nightly_rate: number; // thebe
  weekly_rate: number; // thebe
  monthly_rate: number; // thebe
  min_nights: number;
  max_guests: number;
  deposit_pct: number; // 0–100
  tax_rate_bps: number; // basis points (1400 = 14%)
  currency: string;
  active: boolean;
  updated_at?: string;
  updated_by_name?: string | null;
}

export interface Reservation {
  id: string;
  contact_id: string;
  room_id: string;
  check_in_date: string;
  check_out_date: string;
  status: ReservationStatus;
  source: ReservationSource;
  notes: string | null;
  discount_type: 'PERCENT' | 'FIXED' | null;
  discount_value: number | null;
  discount_reason: string | null;
  discount_approved_at: string | null;
  created_at: string;
  // CRM (A4): who arranged the booking + who the invoice goes to (both optional).
  booking_coordinator_id?: string | null;
  billing_contact_id?: string | null;
  // Enriched by the list endpoint's joins; absent on create/update responses.
  guest_name?: string | null;
  booking_coordinator_name?: string | null;
  billing_contact_name?: string | null;
  room_code?: string | null;
  room_name?: string | null;
  property_id?: string | null;
  property_name?: string | null;
}

export interface Lead {
  id: string;
  title: string;
  description: string | null;
  status: LeadStatus;
  source: LeadSource | null;
  contact_id: string | null;
  phone: string | null;
  // The booking this enquiry became, once converted (P5 CRM).
  converted_reservation_id?: string | null;
  created_at: string;
}

export type MaintenanceStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
export type MaintenancePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface WorkOrder {
  id: string;
  room_id: string;
  title: string;
  description: string | null;
  status: MaintenanceStatus;
  priority: MaintenancePriority;
  reported_by: string;
  assigned_to: string | null;
  completed_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  contractor_name: string | null;
  contractor_phone: string | null;
  cost_amount: number | null;
  cost_approved_at: string | null;
  cost_reconciled_at: string | null;
  opened_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  // Resolved names (LEFT-joined by the list/get endpoints).
  reported_by_name?: string | null;
  assigned_to_name?: string | null;
  completed_by_name?: string | null;
  approved_by_name?: string | null;
  // Unit owner attribution (LEFT-joined from the room): whose repair bill this is.
  room_ownership?: RoomOwnership | null;
  landlord_name?: string | null;
  landlord_phone?: string | null;
}

export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'RECONCILED';

/** A repair cost as Accounts sees it (Finance → Expenses). */
export interface Expense {
  id: string;
  room_id: string;
  room_code: string | null;
  title: string;
  contractor_name: string | null;
  cost_amount: number; // thebe
  status: ExpenseStatus;
  // Owner attribution: Lifestyle's own unit vs a third-party landlord's.
  room_ownership: RoomOwnership | null;
  landlord_name: string | null;
  cost_approved_by_name: string | null;
  cost_approved_at: string | null;
  cost_reconciled_by_name: string | null;
  cost_reconciled_at: string | null;
  opened_at: string;
}

// ── Finance → Reports (Accounts P&L dashboard) ──────────────────────────────
export interface PnlSummary {
  from: string;
  to: string;
  revenue: number;               // thebe
  maintenance_cost: number;
  operating_expenses: number;
  total_cost: number;
  net: number;
  margin_pct: number;
  vat_output: number;
  reservations: number;
  room_nights_booked: number;
  room_nights_available: number;
  occupancy_pct: number;
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
  property_name: string;
  revenue: number;
  maintenance_cost: number;
  operating_expenses: number;
  net: number;
  occupancy_pct: number | null;
}
export interface ReportsResponse {
  summary: PnlSummary;
  monthly: MonthlyPoint[];
  by_property: PropertyPnl[];
}

// ── Finance → Financial Cockpit (P4.2 — real-time receivables) ──────────────
// All amounts thebe. Receivable = open (ISSUED/PARTIALLY_PAID) DEPOSIT/BALANCE
// invoice; ageing runs from the issue date; REFUND liabilities sit apart.
export type AgingBucketKey = '0-30' | '31-60' | '61-90' | '90+';
export interface AgingBucket {
  bucket: AgingBucketKey;
  amount: number;
  count: number;
}
export interface PropertyReceivable {
  property_id: string | null;
  property_name: string;
  amount: number;
  count: number;
}
export interface OutstandingInvoice {
  id: string;
  number: string;
  kind: 'DEPOSIT' | 'BALANCE';
  status: 'ISSUED' | 'PARTIALLY_PAID';
  total_amount: number;
  currency: string;
  bill_to_name: string | null;
  property_id: string | null;
  property_name: string | null;
  created_at: string;
  days_outstanding: number;
}
export interface FinanceCockpit {
  as_of: string;
  summary: {
    total_receivable: number;
    open_invoices: number;
    oldest_days: number;
    refunds_payable: number;
  };
  aging: AgingBucket[];
  by_property: PropertyReceivable[];
  invoices: OutstandingInvoice[];
}

// ── Finance → Operational Cockpit (P4.3 — occupancy + YoY trends) ─────────────
// The hospitality "big three": occupancy, ADR (revenue / booked nights), RevPAR
// (revenue / available nights). Revenue is recognised (paid). Money is thebe.
export interface OpsKpis {
  occupancy_pct: number;
  room_nights_booked: number;
  room_nights_available: number;
  reservations: number;
  revenue: number;
  adr: number;
  revpar: number;
}
export interface OpsMonthlyPoint {
  month: string;   // YYYY-MM
  occupancy_pct: number;
  room_nights_booked: number;
  room_nights_available: number;
  reservations: number;
  revenue: number;
  adr: number;
}
export interface OpsPropertyRow {
  property_id: string | null;
  property_name: string;
  occupancy_pct: number | null;
  room_nights_booked: number;
  reservations: number;
}
export interface OpsDeltas {
  occupancy_pts: number;
  reservations_pct: number | null;
  adr_pct: number | null;
  revpar_pct: number | null;
  revenue_pct: number | null;
}
export interface OperationsResponse {
  window: { from: string; to: string; months: number };
  summary: OpsKpis;
  previous: OpsKpis & { from: string; to: string };
  deltas: OpsDeltas;
  monthly: OpsMonthlyPoint[];
  by_property: OpsPropertyRow[];
}

// ── AI marketing + strategy (P4.4) — LLM-backed, dark until keyed ─────────────
export type SegmentKey = 'vip' | 'frequent' | 'recent' | 'lapsed' | 'prospect';
export type CampaignChannel = 'email' | 'whatsapp' | 'sms';

export interface SegmentSummary {
  key: SegmentKey;
  label: string;
  description: string;
  count: number;
  total_spend: number;   // thebe
  avg_spend: number;     // thebe
  sample_names: string[];
}
export interface SegmentsResponse {
  configured: boolean;   // is the LLM keyed?
  total_customers: number;
  segments: SegmentSummary[];
}
export interface CampaignResponse {
  configured: boolean;
  segment: SegmentKey;
  channel: CampaignChannel;
  copy: string | null;
}
export interface StrategyResponse {
  configured: boolean;
  metrics: {
    from: string;
    to: string;
    occupancy_pct: number;
    revenue: number;
    net: number;
    margin_pct: number;
    properties: Array<{ name: string; occupancy_pct: number | null; revenue: number }>;
  };
  recommendations: string | null;
}

// ── Finance → HR / Payroll ──────────────────────────────────────────────────
export type PayFrequency = 'MONTHLY' | 'WEEKLY';
export interface EmployeePay {
  user_id: string;
  name: string;
  role: string;
  is_lead: boolean;
  job_title: string | null;
  gross_amount: number | null;        // thebe
  frequency: PayFrequency | null;
  monthly_equivalent: number | null;
  payment_method: string | null;
  bank_name: string | null;
  bank_account: string | null;
  start_date: string | null;
  active: boolean;
  notes: string | null;
}
export interface PayrollSummary {
  headcount: number;
  monthly_total: number;              // thebe
  by_role: { role: string; headcount: number; monthly: number }[];
}

// ── Finance → Operating expenses ledger ─────────────────────────────────────
export type OperatingExpenseCategory =
  | 'RENT' | 'PAYROLL' | 'UTILITIES' | 'MARKETING'
  | 'INSURANCE' | 'SUPPLIES' | 'SOFTWARE' | 'OTHER';
export interface OperatingExpense {
  id: string;
  property_id: string | null;
  property_name: string | null;
  category: OperatingExpenseCategory;
  description: string;
  vendor: string | null;
  amount: number;                // thebe
  currency: string;
  incurred_on: string;
  notes: string | null;
  receipt_file_id: string | null;
  receipt_name: string | null;
  created_at: string;
  updated_at: string;
}

// ── Finance → Invoices ──────────────────────────────────────────────────────
export type InvoiceKind = 'DEPOSIT' | 'BALANCE' | 'REFUND';
export type InvoiceStatus = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED' | 'VOID';
export interface Invoice {
  id: string;
  number: string;
  hold_id: string | null;
  quote_id: string | null;
  reservation_id: string | null;
  kind: InvoiceKind;
  currency: string;
  subtotal_amount: number;
  tax_rate_bps: number;
  tax_amount: number;
  total_amount: number;          // thebe
  status: InvoiceStatus;
  receipt_file_id: string | null;
  created_at: string;
  updated_at: string;
}
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface RecurringCost {
  id: string;
  property_id: string | null;
  property_name: string | null;
  category: OperatingExpenseCategory;
  description: string;
  vendor: string | null;
  amount: number;            // thebe
  day_of_month: number;
  active: boolean;
  notes: string | null;
}

/** Minimal staff entry for pickers (assign-to). */
export interface StaffDirectoryEntry {
  id: string;
  name: string;
  role: RoleName;
  is_lead: boolean;
}

export interface Quote {
  id: string;
  unit_type: UnitType;
  nights: number;
  currency: string;
  total_amount: number;
  deposit_amount: number;
  tax_amount: number;
  status: 'ACTIVE' | 'EXPIRED' | 'CONSUMED';
}

export interface InvoiceDocument {
  id: string;
  number: string;
  kind: 'DEPOSIT' | 'BALANCE' | 'REFUND';
  status: InvoiceStatus;
  currency: string;
  subtotal_amount: number;
  tax_rate_bps: number;
  tax_amount: number;
  total_amount: number;
  created_at: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  // The bill-to (A4): the reservation's billing/accounts contact when assigned,
  // otherwise the guest (coalesced server-side).
  bill_to_name: string | null;
  bill_to_email: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  unit_code: string | null;
  unit_name: string | null;
  nights: number | null;
  unit_type: string | null;
}

export interface Hold {
  id: string;
  quote_id: string;
  reservation_id: string | null;
  room_id: string | null;
  status: 'HELD' | 'CONFIRMED' | 'EXPIRED' | 'RELEASED';
  held_until: string;
}

export interface PaymentIntent {
  id: string;
  hold_id: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: 'PENDING' | 'RETRY' | 'PAID' | 'FAILED' | 'EXPIRED';
  attempts: number;
  max_attempts: number;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Users & Roles ─────────────────────────────────────────────────────────────

export type RoleName = 'admin' | 'operations' | 'reception' | 'accounts' | 'maintenance' | 'housekeeping';

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  active: boolean;
  /** Team rank within a role (head cleaner / vice) — not a separate role. */
  is_lead: boolean;
  /** Permission names granted on top of the role (second-hat staff). */
  extra_permissions: string[];
  /** Properties this user may enter (multi-property scope). */
  property_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface RoleInfo {
  id: number;
  name: RoleName;
  permissions: string[];
}
