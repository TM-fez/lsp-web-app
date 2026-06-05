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
  audit_logs: AuditLogsTable;
  feature_flags: FeatureFlagsTable;
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
