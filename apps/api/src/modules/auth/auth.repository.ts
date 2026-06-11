import { createHash } from 'crypto';
import { db } from '../../config/db.js';
import type { UserRecord, RefreshTokenRecord } from './auth.types.js';
import type { Role } from '@lsp/shared-types';

// ── User queries ──────────────────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const row = await db
    .selectFrom('users')
    .select(['id', 'name', 'email', 'password_hash', 'role_id', 'active'])
    .where('email', '=', email)
    .executeTakeFirst();

  if (!row) return null;

  const roleRow = await db
    .selectFrom('roles')
    .select('name')
    .where('id', '=', row.role_id)
    .executeTakeFirst();

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    roleId: row.role_id,
    roleName: (roleRow?.name ?? 'reception') as Role,
    active: row.active,
  };
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const row = await db
    .selectFrom('users')
    .select(['id', 'name', 'email', 'password_hash', 'role_id', 'active'])
    .where('id', '=', id)
    .where('active', '=', true)
    .executeTakeFirst();

  if (!row) return null;

  const roleRow = await db
    .selectFrom('roles')
    .select('name')
    .where('id', '=', row.role_id)
    .executeTakeFirst();

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    roleId: row.role_id,
    roleName: (roleRow?.name ?? 'reception') as Role,
    active: row.active,
  };
}

export async function findPermissionsByRoleId(roleId: number): Promise<string[]> {
  const rows = await db
    .selectFrom('permissions')
    .innerJoin('role_permissions', 'role_permissions.permission_id', 'permissions.id')
    .select('permissions.name')
    .where('role_permissions.role_id', '=', roleId)
    .execute();

  return rows.map((r) => r.name);
}

/**
 * Effective permissions = role permissions ∪ per-user extra grants
 * (user_permissions — second-hat staff, e.g. a cleaner who also covers reception).
 */
export async function findEffectivePermissions(userId: string, roleId: number): Promise<string[]> {
  const [rolePerms, extraRows] = await Promise.all([
    findPermissionsByRoleId(roleId),
    db
      .selectFrom('permissions')
      .innerJoin('user_permissions', 'user_permissions.permission_id', 'permissions.id')
      .select('permissions.name')
      .where('user_permissions.user_id', '=', userId)
      .execute(),
  ]);

  return [...new Set([...rolePerms, ...extraRows.map((r) => r.name)])];
}

// ── Refresh token queries ──────────────────────────────────────────────────────

export async function saveRefreshToken(data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await db
    .insertInto('refresh_tokens')
    .values({
      user_id: data.userId,
      token_hash: data.tokenHash,
      expires_at: data.expiresAt,
    })
    .execute();
}

export async function findRefreshTokenByHash(
  hash: string
): Promise<RefreshTokenRecord | null> {
  const row = await db
    .selectFrom('refresh_tokens')
    .select(['id', 'user_id', 'token_hash', 'expires_at', 'revoked'])
    .where('token_hash', '=', hash)
    .executeTakeFirst();

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revoked: row.revoked,
  };
}

export async function revokeRefreshToken(id: string): Promise<void> {
  await db
    .updateTable('refresh_tokens')
    .set({ revoked: true })
    .where('id', '=', id)
    .execute();
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await db
    .updateTable('refresh_tokens')
    .set({ revoked: true })
    .where('user_id', '=', userId)
    .where('revoked', '=', false)
    .execute();
}

// ── Crypto helper ─────────────────────────────────────────────────────────────

/** SHA-256 hash of a raw refresh token string for safe DB storage. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
