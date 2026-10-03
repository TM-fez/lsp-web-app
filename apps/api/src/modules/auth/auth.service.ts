import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { env } from '../../config/env.js';
import { jwtKeys } from '../../config/jwt.js';
import { AppError } from '../../core/errors/AppError.js';
import { writeAuditLog } from '../../core/audit/audit.service.js';
import * as authRepo from './auth.repository.js';
import type { AuthUser, TokenPair, RequestMeta } from './auth.types.js';
import type { JwtPayload } from '@lsp/shared-types';

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildAccessToken(user: AuthUser, sessionId: string): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    // (H7) The login session this token belongs to — authenticate checks it is still open.
    sid: sessionId,
  };
  return jwt.sign(payload, jwtKeys.privateKey, {
    algorithm: 'RS256',
    expiresIn: env.JWT_ACCESS_EXPIRY as jwt.SignOptions['expiresIn'],
  });
}

function buildRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(64).toString('hex');
  return { raw, hash: authRepo.hashRefreshToken(raw) };
}

function refreshTokenExpiresAt(): Date {
  const ttl = env.JWT_REFRESH_EXPIRY;
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid JWT_REFRESH_EXPIRY format: ${ttl}`);
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const ms = parseInt(match[1]!, 10) * (multipliers[match[2]!] ?? 0);
  return new Date(Date.now() + ms);
}

async function buildAuthUser(userId: string): Promise<AuthUser> {
  const user = await authRepo.findUserById(userId);
  if (!user || !user.active) throw AppError.unauthorized('Account not found or inactive');

  const permissions = await authRepo.findEffectivePermissions(user.id, user.roleId);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.roleName,
    permissions,
  };
}

// ── Public service methods ────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
  meta: RequestMeta
): Promise<{ tokens: TokenPair; user: AuthUser }> {
  const userRow = await authRepo.findUserByEmail(email);

  // Deliberate timing parity: run bcrypt even on unknown email to prevent
  // user enumeration via response time differences. Must be a WELL-FORMED hash
  // (60 chars, matching BCRYPT_ROUNDS) — bcrypt rejects a malformed one instantly,
  // which would leak "user not found" through the fast path. Hash of a discarded
  // random secret; it can never match any password.
  const DUMMY_HASH = '$2b$12$8im/hIB6B9xgyhtl1G/ve.MF8krR.eYb3Z6scW02XRcZQ4mbj1zzS';
  const hashToCompare = userRow?.passwordHash ?? DUMMY_HASH;
  const passwordMatch = await bcrypt.compare(password, hashToCompare);

  if (!userRow || !passwordMatch) {
    await writeAuditLog({
      request_id: meta.requestId ?? null,
      user_id: userRow?.id ?? null,
      action: 'CREATE',
      entity: 'auth_login',
      entity_id: userRow?.id ?? email,
      diff: JSON.stringify({ success: false, reason: !userRow ? 'user_not_found' : 'wrong_password' }),
      ip_address: meta.ip ?? null,
    });
    throw AppError.unauthorized('Invalid credentials');
  }

  if (!userRow.active) {
    throw AppError.unauthorized('Account is inactive');
  }

  const permissions = await authRepo.findEffectivePermissions(userRow.id, userRow.roleId);
  const user: AuthUser = {
    id: userRow.id,
    name: userRow.name,
    email: userRow.email,
    role: userRow.roleName,
    permissions,
  };

  const sessionId = randomUUID();
  const accessToken = buildAccessToken(user, sessionId);
  const { raw, hash } = buildRefreshToken();

  await authRepo.saveRefreshToken({
    userId: user.id,
    tokenHash: hash,
    expiresAt: refreshTokenExpiresAt(),
    sessionId,
  });

  await writeAuditLog({
    request_id: meta.requestId ?? null,
    user_id: user.id,
    action: 'CREATE',
    entity: 'auth_login',
    entity_id: user.id,
    diff: JSON.stringify({ success: true }),
    ip_address: meta.ip ?? null,
  });

  return { tokens: { accessToken, rawRefreshToken: raw }, user };
}

export async function refresh(
  rawRefreshToken: string,
  meta: RequestMeta
): Promise<{ tokens: TokenPair; user: AuthUser }> {
  const hash = authRepo.hashRefreshToken(rawRefreshToken);
  const tokenRow = await authRepo.findRefreshTokenByHash(hash);

  if (!tokenRow || tokenRow.revoked || tokenRow.expiresAt < new Date()) {
    throw AppError.unauthorized('Refresh token is invalid or has expired');
  }

  const user = await buildAuthUser(tokenRow.userId);

  // Rotate, carrying the session forward. The new token is saved BEFORE the old one is
  // revoked (H7): authenticate accepts an access token only while its session has a live
  // refresh token, so revoking first left a gap in which the user's other in-flight
  // requests were rejected mid-rotation.
  const accessToken = buildAccessToken(user, tokenRow.sessionId);
  const { raw, hash: newHash } = buildRefreshToken();

  await authRepo.saveRefreshToken({
    userId: user.id,
    tokenHash: newHash,
    expiresAt: refreshTokenExpiresAt(),
    sessionId: tokenRow.sessionId,
  });
  await authRepo.revokeRefreshToken(tokenRow.id);

  await writeAuditLog({
    request_id: meta.requestId ?? null,
    user_id: user.id,
    action: 'UPDATE',
    entity: 'refresh_token',
    entity_id: tokenRow.id,
    diff: JSON.stringify({ rotated: true }),
    ip_address: meta.ip ?? null,
  });

  return { tokens: { accessToken, rawRefreshToken: raw }, user };
}

export async function logout(
  rawRefreshToken: string,
  meta: RequestMeta
): Promise<void> {
  const hash = authRepo.hashRefreshToken(rawRefreshToken);
  const tokenRow = await authRepo.findRefreshTokenByHash(hash);

  // Silently succeed if token not found — idempotent logout
  if (!tokenRow || tokenRow.revoked) return;

  await authRepo.revokeRefreshToken(tokenRow.id);

  await writeAuditLog({
    request_id: meta.requestId ?? null,
    user_id: tokenRow.userId,
    action: 'DELETE',
    entity: 'refresh_token',
    entity_id: tokenRow.id,
    diff: null,
    ip_address: meta.ip ?? null,
  });
}

export async function logoutAll(userId: string, meta: RequestMeta): Promise<void> {
  await authRepo.revokeAllUserRefreshTokens(userId);

  await writeAuditLog({
    request_id: meta.requestId ?? null,
    user_id: userId,
    action: 'DELETE',
    entity: 'refresh_token',
    entity_id: userId,
    diff: JSON.stringify({ scope: 'all_sessions' }),
    ip_address: meta.ip ?? null,
  });
}

/**
 * (H7) Reject a token whose session has ended or whose holder has changed under it.
 *
 * The JWT alone is trusted for 15 minutes; this closes that window:
 *   · logged out / "log out everywhere"  → no live refresh token in the session → 401
 *   · deactivated                        → 401
 *   · role changed, or a permission the token claims has been taken away → 401; the web
 *     client refreshes, and the new token carries the new permissions.
 *
 * Tokens with no `sid` (issued before this check existed — 15 minutes at most) are left
 * to expire on their own.
 */
export async function assertSessionLive(payload: JwtPayload): Promise<void> {
  if (!payload.sid) return;
  const session = await authRepo.findLiveSession(payload.sid, payload.sub);
  if (!session) throw AppError.unauthorized('Your session has ended. Please sign in again.');
  if (!session.active) throw AppError.unauthorized('Account is inactive');
  if (session.role !== payload.role) throw AppError.unauthorized('Your access has changed. Please sign in again.');
  const current = new Set(await authRepo.findEffectivePermissions(payload.sub, session.roleId));
  if (payload.permissions.some((p) => !current.has(p))) {
    throw AppError.unauthorized('Your access has changed. Please sign in again.');
  }
}

/**
 * (P7) Change your own password. A wrong current password is a 400, not a 401: the web
 * client treats 401 as "token expired" and would silently refresh and retry.
 */
export async function changePassword(
  userId: string,
  sessionId: string | undefined,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta
): Promise<void> {
  const user = await authRepo.findUserById(userId);
  if (!user) throw AppError.unauthorized('Account not found or inactive');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw AppError.badRequest('Your current password is incorrect.');
  }
  const hash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await authRepo.changeOwnPassword(userId, hash, sessionId, meta);
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, jwtKeys.publicKey, {
      algorithms: ['RS256'],
    }) as JwtPayload;
  } catch {
    throw AppError.unauthorized('Token invalid or expired');
  }
}
