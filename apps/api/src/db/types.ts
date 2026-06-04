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
  uploaded_by: string;
  driver: 'local' | 's3';
  bucket: string | null;
  key: string;
  mime_type: string;
  size_bytes: number;
  created_at: Generated<Date>;
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

export type AuditLogRow   = Selectable<AuditLogsTable>;
export type NewAuditLog   = Insertable<AuditLogsTable>;

export type FlagRow       = Selectable<FeatureFlagsTable>;
export type FileRow       = Selectable<FilesTable>;
