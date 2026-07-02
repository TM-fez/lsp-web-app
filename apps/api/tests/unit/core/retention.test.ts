import { describe, it, expect, vi } from 'vitest';
import { runRetention, createRetentionSweeper, type RetentionDeps } from '../../../src/core/retention.js';

function makeDeps(over: Partial<RetentionDeps> = {}): RetentionDeps {
  return {
    deleteDeadRefreshTokens: vi.fn().mockResolvedValue(7),
    deleteOldAuditLogs: vi.fn().mockResolvedValue(3),
    ...over,
  };
}

describe('runRetention', () => {
  it('prunes dead refresh tokens with a cutoff N days back', async () => {
    const deps = makeDeps();
    const now = new Date('2026-07-31T00:00:00Z');

    const res = await runRetention(deps, { refreshTokenDays: 30, auditLogDays: 0 }, now);

    expect(res).toEqual({ refreshTokensPruned: 7, auditLogsPruned: 0 });
    expect(deps.deleteDeadRefreshTokens).toHaveBeenCalledWith(new Date('2026-07-01T00:00:00Z'));
  });

  it('NEVER touches audit logs unless a retention window is opted into', async () => {
    const deps = makeDeps();

    await runRetention(deps, { refreshTokenDays: 30, auditLogDays: 0 });

    expect(deps.deleteOldAuditLogs).not.toHaveBeenCalled();
  });

  it('prunes audit logs only with an explicit window', async () => {
    const deps = makeDeps();
    const now = new Date('2027-01-01T00:00:00Z');

    const res = await runRetention(deps, { refreshTokenDays: 0, auditLogDays: 365 }, now);

    expect(res).toEqual({ refreshTokensPruned: 0, auditLogsPruned: 3 });
    expect(deps.deleteDeadRefreshTokens).not.toHaveBeenCalled();
    expect(deps.deleteOldAuditLogs).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00Z'));
  });
});

describe('createRetentionSweeper', () => {
  it('runs at most once per interval — in-between calls return zeros without touching the DB', async () => {
    const deps = makeDeps();
    const sweep = createRetentionSweeper(undefined, deps);

    const first = await sweep();
    const second = await sweep();

    expect(first.refreshTokensPruned).toBe(7);
    expect(second).toEqual({ refreshTokensPruned: 0, auditLogsPruned: 0 });
    expect(deps.deleteDeadRefreshTokens).toHaveBeenCalledTimes(1);
  });
});
