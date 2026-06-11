import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock all external dependencies before importing the service ───────────────

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash:    vi.fn(),
  },
}));

vi.mock('../../src/config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_COOKIE_NAME: 'lsp_refresh',
    BCRYPT_ROUNDS: 12,
  },
}));

vi.mock('../../src/config/jwt.js', () => ({
  jwtKeys: {
    get privateKey() { return 'mock-private-key'; },
    get publicKey()  { return 'mock-public-key'; },
  },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign:   vi.fn(() => 'mock.access.token'),
    verify: vi.fn(() => ({
      sub: 'user-id-1',
      email: 'admin@lsp.local',
      role: 'admin',
      permissions: ['contacts:read'],
    })),
  },
}));

vi.mock('../../src/core/audit/audit.service.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/auth/auth.repository.js', () => ({
  findUserByEmail:             vi.fn(),
  findUserById:                vi.fn(),
  findPermissionsByRoleId:     vi.fn(),
  findEffectivePermissions:    vi.fn(),
  saveRefreshToken:            vi.fn().mockResolvedValue(undefined),
  findRefreshTokenByHash:      vi.fn(),
  revokeRefreshToken:          vi.fn().mockResolvedValue(undefined),
  revokeAllUserRefreshTokens:  vi.fn().mockResolvedValue(undefined),
  hashRefreshToken:            vi.fn((raw: string) => `hashed:${raw}`),
}));

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as authRepo from '../../src/modules/auth/auth.repository.js';
import * as authService from '../../src/modules/auth/auth.service.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_RECORD = {
  id: 'user-id-1',
  name: 'Admin User',
  email: 'admin@lsp.local',
  roleId: 1,
  roleName: 'admin' as const,
  passwordHash: 'stored-hash',
  active: true,
};

const REFRESH_TOKEN_RECORD = {
  id: 'token-id-1',
  userId: 'user-id-1',
  tokenHash: 'hashed:some-raw-token',
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  revoked: false,
};

const META = { ip: '127.0.0.1', requestId: 'req-id-1' };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('authService.login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tokens and user on valid credentials', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(USER_RECORD);
    vi.mocked(authRepo.findEffectivePermissions).mockResolvedValue(['contacts:read']);

    const result = await authService.login('admin@lsp.local', 'Correct@1', META);

    expect(result.tokens.accessToken).toBe('mock.access.token');
    expect(result.tokens.rawRefreshToken).toBeTruthy();
    expect(result.user.email).toBe('admin@lsp.local');
    expect(result.user.role).toBe('admin');
    expect(authRepo.saveRefreshToken).toHaveBeenCalledOnce();
  });

  it('throws 401 for unknown email', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);

    await expect(
      authService.login('nobody@lsp.local', 'anypass', META)
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
  });

  it('throws 401 for wrong password', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(USER_RECORD);

    await expect(
      authService.login('admin@lsp.local', 'Wrong@999', META)
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials' });
  });

  it('throws 401 for inactive account', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue({
      ...USER_RECORD,
      active: false,
    });

    await expect(
      authService.login('admin@lsp.local', 'Correct@1', META)
    ).rejects.toMatchObject({ statusCode: 401, message: 'Account is inactive' });
  });

  it('calls bcrypt.compare even when user is not found (timing parity)', async () => {
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    vi.mocked(authRepo.findUserByEmail).mockResolvedValue(null);

    await authService.login('nobody@lsp.local', 'somepass', META).catch(() => {});

    // bcrypt.compare must run against the dummy hash so response time
    // does not reveal whether the email exists
    expect(bcrypt.compare).toHaveBeenCalledOnce();
  });
});

describe('authService.refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rotates token and returns new pair', async () => {
    vi.mocked(authRepo.findRefreshTokenByHash).mockResolvedValue(REFRESH_TOKEN_RECORD);
    vi.mocked(authRepo.findUserById).mockResolvedValue(USER_RECORD);
    vi.mocked(authRepo.findEffectivePermissions).mockResolvedValue(['contacts:read']);

    const result = await authService.refresh('some-raw-token', META);

    expect(authRepo.revokeRefreshToken).toHaveBeenCalledWith('token-id-1');
    expect(authRepo.saveRefreshToken).toHaveBeenCalledOnce();
    expect(result.tokens.accessToken).toBe('mock.access.token');
  });

  it('throws 401 for revoked token', async () => {
    vi.mocked(authRepo.findRefreshTokenByHash).mockResolvedValue({
      ...REFRESH_TOKEN_RECORD,
      revoked: true,
    });

    await expect(
      authService.refresh('revoked-token', META)
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 401 for expired token', async () => {
    vi.mocked(authRepo.findRefreshTokenByHash).mockResolvedValue({
      ...REFRESH_TOKEN_RECORD,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      authService.refresh('expired-token', META)
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 401 for unknown token', async () => {
    vi.mocked(authRepo.findRefreshTokenByHash).mockResolvedValue(null);

    await expect(
      authService.refresh('unknown-token', META)
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('authService.logout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revokes token on valid logout', async () => {
    vi.mocked(authRepo.findRefreshTokenByHash).mockResolvedValue(REFRESH_TOKEN_RECORD);

    await authService.logout('some-raw-token', META);

    expect(authRepo.revokeRefreshToken).toHaveBeenCalledWith('token-id-1');
  });

  it('succeeds silently if token not found (idempotent)', async () => {
    vi.mocked(authRepo.findRefreshTokenByHash).mockResolvedValue(null);

    await expect(authService.logout('unknown-token', META)).resolves.toBeUndefined();
    expect(authRepo.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('succeeds silently if token already revoked', async () => {
    vi.mocked(authRepo.findRefreshTokenByHash).mockResolvedValue({
      ...REFRESH_TOKEN_RECORD,
      revoked: true,
    });

    await expect(authService.logout('revoked-token', META)).resolves.toBeUndefined();
    expect(authRepo.revokeRefreshToken).not.toHaveBeenCalled();
  });
});

describe('authService.verifyAccessToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns decoded payload for a valid token', () => {
    const payload = authService.verifyAccessToken('mock.access.token');
    expect(payload.sub).toBe('user-id-1');
    expect(payload.role).toBe('admin');
  });

  it('throws 401 for invalid token', () => {
    vi.mocked(jwt.verify).mockImplementationOnce(() => { throw new Error('jwt malformed'); });

    expect(() => authService.verifyAccessToken('bad.token'))
      .toThrow(expect.objectContaining({ statusCode: 401 }));
  });
});
