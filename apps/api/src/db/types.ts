import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

// ── Tables ────────────────────────────────────────────────────────────────────

export interface RolesTable {
  id: Generated<number>;
  name: string;
}

export interface PermissionsTable {
  id: Generated<number>;
  name: string;
  module: string;
}

export interface RolePermissionsTable {
  role_id: number;
  permission_id: number;
}

export interface UsersTable {
  id: Generated<string>;
  role_id: number;
  name: string;
  email: string;
  password_hash: string;
  active: Generated<boolean>;
  avatar_file_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface FilesTable {
  id: Generated<string>;
  original_name: string;
  stored_name: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  checksum: string;
  storage_driver: 'local' | 's3';
  bucket: string | null;
  path: string;
  is_public: Generated<boolean>;
  created_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ContactsTable {
  id: Generated<string>;
  type: 'individual' | 'company';
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  notes: string | null;
  avatar_file_id: string | null;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface LeadsTable {
  id: Generated<string>;
  title: string;
  description: string | null;
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST';
  contact_id: string | null;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ReservationsTable {
  id: Generated<string>;
  contact_id: string;
  room_id: string;
  check_in_date: Date;
  check_out_date: Date;
  status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
  notes: string | null;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  document_file_id?: string | null;
}

export interface RoomsTable {
  id: Generated<string>;
  name: string;
  code: string;
  type: 'STANDARD' | 'DELUXE' | 'SUITE' | 'CONFERENCE' | 'CUSTOM';
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
  capacity: number;
  notes: string | null;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  image_file_id?: string | null;
}

export interface OccupancyTable {
  id: Generated<string>;
  reservation_id: string;
  room_id: string;
  status: 'CHECKED_IN' | 'CHECKED_OUT';
  checked_in_at: Generated<Date>;
  checked_out_at: Date | null;
  guest_count: Generated<number>;
  notes: string | null;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  document_file_id?: string | null;
}

export interface MaintenanceWorkOrdersTable {
  id: Generated<string>;
  room_id: string;
  title: string;
  description: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reported_by: string;
  assigned_to: string | null;
  before_file_id: string | null;
  after_file_id: string | null;
  opened_at: Generated<Date>;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  request_id: string | null;
  user_id: string | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  entity_id: string;
  diff: unknown | null;
  ip_address: string | null;
  created_at: Generated<Date>;
}

export interface FeatureFlagsTable {
  key: string;
  enabled: Generated<boolean>;
  rollout_pct: Generated<number>;
  description: string | null;
  metadata: Generated<Record<string, unknown>>;
  updated_at: Generated<Date>;
}

// ── Sprint 8 — Commercial Core ────────────────────────────────────────────────
// All money columns are INTEGER minor units (thebe; 100 = 1 BWP).

export interface RatePlansTable {
  id: Generated<string>;
  unit_type: 'STANDARD' | 'DELUXE' | 'SUITE' | 'CONFERENCE' | 'CUSTOM';
  name: string;
  nightly_rate: number;
  weekly_rate: number;
  monthly_rate: number;
  min_nights: Generated<number>;
  max_guests: Generated<number>;
  deposit_pct: Generated<number>;
  tax_rate_bps: Generated<number>;
  currency: Generated<string>;
  active: Generated<boolean>;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface QuotesTable {
  id: Generated<string>;
  rate_plan_id: string;
  unit_type: 'STANDARD' | 'DELUXE' | 'SUITE' | 'CONFERENCE' | 'CUSTOM';
  check_in_date: Date;
  check_out_date: Date;
  guests: Generated<number>;
  nights: number;
  currency: Generated<string>;
  base_amount: number;
  adjustment_amount: Generated<number>;
  adjustment_reason: string | null;
  tax_rate_bps: number;
  tax_amount: number;
  deposit_amount: number;
  total_amount: number;
  breakdown: Generated<unknown>;
  status: Generated<'ACTIVE' | 'EXPIRED' | 'CONSUMED'>;
  created_by: string;
  override_by: string | null;
  expires_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface HoldsTable {
  id: Generated<string>;
  quote_id: string;
  reservation_id: string | null;
  room_id: string | null;
  status: Generated<'HELD' | 'CONFIRMED' | 'EXPIRED' | 'RELEASED'>;
  held_until: Date;
  retry_count: Generated<number>;
  release_reason: string | null;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PaymentIntentsTable {
  id: Generated<string>;
  hold_id: string;
  quote_id: string;
  invoice_id: string | null;
  purpose: Generated<'DEPOSIT' | 'BALANCE'>;
  amount: number;
  currency: Generated<string>;
  method: 'CARD' | 'MOBILE_MONEY' | 'EFT' | 'CASH' | 'CORPORATE_CREDIT';
  status: Generated<'PENDING' | 'RETRY' | 'PAID' | 'FAILED' | 'EXPIRED'>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  last_error: string | null;
  paid_at: Date | null;
  created_by: string;
  updated_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PaymentAttemptsTable {
  id: Generated<string>;
  payment_intent_id: string;
  attempt_no: number;
  outcome: 'INITIATED' | 'SUCCESS' | 'FAILURE';
  method: 'CARD' | 'MOBILE_MONEY' | 'EFT' | 'CASH' | 'CORPORATE_CREDIT';
  reference: string | null;
  note: string | null;
  created_by: string;
  created_at: Generated<Date>;
}

export interface InvoicesTable {
  id: Generated<string>;
  number: string;
  hold_id: string | null;
  quote_id: string | null;
  reservation_id: string | null;
  kind: 'DEPOSIT' | 'BALANCE' | 'REFUND';
  currency: Generated<string>;
  subtotal_amount: number;
  tax_rate_bps: number;
  tax_amount: number;
  total_amount: number;
  status: Generated<'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED' | 'VOID'>;
  receipt_file_id: string | null;
  issued_by: string;
  created_by: string;
  updated_by: string;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// ── Database interface ────────────────────────────────────────────────────────

export interface Database {
  roles: RolesTable;
  permissions: PermissionsTable;
  role_permissions: RolePermissionsTable;
  users: UsersTable;
  refresh_tokens: RefreshTokensTable;
  files: FilesTable;
  contacts: ContactsTable;
  leads: LeadsTable;
  reservations: ReservationsTable;
  rooms: RoomsTable;
  occupancy: OccupancyTable;
  maintenance_work_orders: MaintenanceWorkOrdersTable;
  audit_logs: AuditLogsTable;
  feature_flags: FeatureFlagsTable;
  rate_plans: RatePlansTable;
  quotes: QuotesTable;
  holds: HoldsTable;
  payment_intents: PaymentIntentsTable;
  payment_attempts: PaymentAttemptsTable;
  invoices: InvoicesTable;
}

// ── Row type helpers ──────────────────────────────────────────────────────────

export type UserRow       = Selectable<UsersTable>;
export type NewUser       = Insertable<UsersTable>;
export type UpdateUser    = Updateable<UsersTable>;

export type ContactRow    = Selectable<ContactsTable>;
export type NewContact    = Insertable<ContactsTable>;
export type UpdateContact = Updateable<ContactsTable>;

export type LeadRow       = Selectable<LeadsTable>;
export type NewLead       = Insertable<LeadsTable>;
export type UpdateLead    = Updateable<LeadsTable>;

export type ReservationRow    = Selectable<ReservationsTable>;
export type NewReservation    = Insertable<ReservationsTable>;
export type UpdateReservation = Updateable<ReservationsTable>;

export type RoomRow       = Selectable<RoomsTable>;
export type NewRoom       = Insertable<RoomsTable>;
export type UpdateRoom    = Updateable<RoomsTable>;

export type OccupancyRow    = Selectable<OccupancyTable>;
export type NewOccupancy    = Insertable<OccupancyTable>;
export type UpdateOccupancy = Updateable<OccupancyTable>;

export type AuditLogRow   = Selectable<AuditLogsTable>;
export type NewAuditLog   = Insertable<AuditLogsTable>;

export type FlagRow       = Selectable<FeatureFlagsTable>;

export type FileRow       = Selectable<FilesTable>;
export type NewFile       = Insertable<FilesTable>;
export type UpdateFile    = Updateable<FilesTable>;

export type MaintenanceWorkOrderRow       = Selectable<MaintenanceWorkOrdersTable>;
export type NewMaintenanceWorkOrder       = Insertable<MaintenanceWorkOrdersTable>;
export type UpdateMaintenanceWorkOrder    = Updateable<MaintenanceWorkOrdersTable>;

// ── Sprint 8 — Commercial Core row helpers ────────────────────────────────────

export type RatePlanRow    = Selectable<RatePlansTable>;
export type NewRatePlan    = Insertable<RatePlansTable>;
export type UpdateRatePlan = Updateable<RatePlansTable>;

export type QuoteRow       = Selectable<QuotesTable>;
export type NewQuote       = Insertable<QuotesTable>;
export type UpdateQuote    = Updateable<QuotesTable>;

export type HoldRow        = Selectable<HoldsTable>;
export type NewHold        = Insertable<HoldsTable>;
export type UpdateHold     = Updateable<HoldsTable>;

export type PaymentIntentRow    = Selectable<PaymentIntentsTable>;
export type NewPaymentIntent    = Insertable<PaymentIntentsTable>;
export type UpdatePaymentIntent = Updateable<PaymentIntentsTable>;

export type PaymentAttemptRow   = Selectable<PaymentAttemptsTable>;
export type NewPaymentAttempt   = Insertable<PaymentAttemptsTable>;

export type InvoiceRow     = Selectable<InvoicesTable>;
export type NewInvoice     = Insertable<InvoicesTable>;
export type UpdateInvoice  = Updateable<InvoicesTable>;
