import type { Role } from '@lsp/shared-types';

/** Authenticated user shape used internally throughout the auth module. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: string[];
}

/** Access + raw refresh token pair produced on login or refresh. */
export interface TokenPair {
  accessToken: string;
  rawRefreshToken: string;
}

/** HTTP request metadata forwarded to audit log entries. */
export interface RequestMeta {
  ip: string | undefined;
  requestId: string | undefined;
}

/**
 * User row returned by auth repository queries — includes joined role name
 * and raw password hash for bcrypt comparison.
 */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  roleId: number;
  roleName: Role;
  passwordHash: string;
  active: boolean;
}

/** Shape of a refresh token row from the database. */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revoked: boolean;
}
