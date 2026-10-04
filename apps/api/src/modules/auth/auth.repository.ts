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
  sessionId: string;
}): Promise<void> {
  await db
    .insertInto('refresh_tokens')
    .values({
      user_id: data.userId,
      token_hash: data.tokenHash,
      expires_at: data.expiresAt,
      session_id: data.sessionId,
    })
    .execute();
}

export async function findRefreshTokenByHash(
  hash: string
): Promise<RefreshTokenRecord | null> {
  const row = await db
    .selectFrom('refresh_tokens')
    .select(['id', 'user_id', 'token_hash', 'expires_at', 'revoked', 'revoked_at', 'session_id'])
    .where('token_hash', '=', hash)
    .executeTakeFirst();

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revoked: row.revoked,
    revokedAt: row.revoked_at,
    sessionId: row.session_id,
  };
}

/**
 * (H7) Is this login session still open, and who is the user now? Null when the session
 * has ended (logged out, all refresh tokens revoked or expired) or the user is gone.
 * One indexed query per authenticated request — the price of logout meaning logout.
 */
export async function findLiveSession(
  sessionId: string,
  userId: string
): Promise<{ active: boolean; role: string; roleId: number } | null> {
  const row = await db
    .selectFrom('refresh_tokens as rt')
    .innerJoin('users as u', 'u.id', 'rt.user_id')
    .innerJoin('roles as r', 'r.id', 'u.role_id')
    .select(['u.active', 'r.name as role', 'u.role_id'])
    .where('rt.session_id', '=', sessionId)
    .where('rt.user_id', '=', userId)
    .where('rt.revoked', '=', false)
    .where('rt.expires_at', '>', new Date())
    .limit(1)
    .executeTakeFirst();
  return row ? { active: row.active, role: row.role, roleId: row.role_id } : null;
}

/**
 * (Re-test round 3) Rotate a refresh token atomically: issue the new one and revoke the
 * old one in ONE transaction, the revoke conditional on the old one still being live.
 * Two refreshes racing with the same token both used to mint a new token — a forked
 * session with two live tokens. Now exactly one wins; the loser gets false (→ 401).
 * Both writes commit together, so there is still no moment with no live token (H7).
 */
export async function rotateRefreshToken(
  oldId: string,
  next: { userId: string; tokenHash: string; expiresAt: Date; sessionId: string }
): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    const revoked = await trx
      .updateTable('refresh_tokens')
      .set({ revoked: true, revoked_at: new Date() })
      .where('id', '=', oldId)
      .where('revoked', '=', false)
      .returning('id')
      .executeTakeFirst();
    if (!revoked) return false;
    await trx.insertInto('refresh_tokens').values({
      user_id: next.userId,
      token_hash: next.tokenHash,
      expires_at: next.expiresAt,
      session_id: next.sessionId,
    }).execute();
    return true;
  });
}

export async function revokeRefreshToken(id: string): Promise<void> {
  await db
    .updateTable('refresh_tokens')
    .set({ revoked: true, revoked_at: new Date() })
    .where('id', '=', id)
    .execute();
}

/** End one login session: every still-live refresh token in it. Returns how many. */
export async function revokeSession(sessionId: string): Promise<number> {
  const res = await db
    .updateTable('refresh_tokens')
    .set({ revoked: true, revoked_at: new Date() })
    .where('session_id', '=', sessionId)
    .where('revoked', '=', false)
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await db
    .updateTable('refresh_tokens')
    .set({ revoked: true, revoked_at: new Date() })
    .where('user_id', '=', userId)
    .where('revoked', '=', false)
    .execute();
}

// ── Crypto helper ─────────────────────────────────────────────────────────────

/** SHA-256 hash of a raw refresh token string for safe DB storage. */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * (P7) Set a user's own new password and end every OTHER login session, with the audit row,
 * in one transaction. The session making the change stays signed in — the person is right
 * there — but a phone or laptop someone else might be holding is cut off on its next request
 * (H7: an access token is honoured only while its session has a live refresh token).
 */
export async function changeOwnPassword(
  userId: string,
  passwordHash: string,
  keepSessionId: string | undefined,
  meta: { requestId?: string | null; ip?: string | null }
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('users').set({ password_hash: passwordHash, updated_at: new Date() }).where('id', '=', userId).execute();
    let revoke = trx.updateTable('refresh_tokens').set({ revoked: true, revoked_at: new Date() }).where('user_id', '=', userId).where('revoked', '=', false);
    if (keepSessionId) revoke = revoke.where('session_id', '<>', keepSessionId);
    const revoked = await revoke.executeTakeFirst();
    await trx.insertInto('audit_logs').values({
      request_id: meta.requestId ?? null,
      user_id: userId,
      action: 'UPDATE',
      entity: 'users',
      entity_id: userId,
      diff: { password: 'changed by the user', other_sessions_ended: Number(revoked.numUpdatedRows) },
      ip_address: meta.ip ?? null,
    }).execute();
  });
}
