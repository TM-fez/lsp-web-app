import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/modules/dashboard/dashboard.repository.js', () => ({
  getAggregateStats:      vi.fn(),
  getRecentAuditActivity: vi.fn(),
}));

import * as dashboardRepo    from '../../src/modules/dashboard/dashboard.repository.js';
import * as dashboardService from '../../src/modules/dashboard/dashboard.service.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RAW_STATS = {
  totalContacts:      42,
  totalUsers:         7,
};

const RAW_ACTIVITY = [
  {
    id:        'log-id-1',
    action:    'CREATE',
    entity:    'auth_login',
    entityId:  'user-id-1',
    userId:    'user-id-1',
    userName:  'Admin User',
    createdAt: new Date('2026-06-05T10:00:00Z'),
  },
  {
    id:        'log-id-2',
    action:    'UPDATE',
    entity:    'contacts',
    entityId:  'contact-id-1',
    userId:    'user-id-1',
    userName:  'Admin User',
    createdAt: new Date('2026-06-05T09:00:00Z'),
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('dashboardService.getStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardService.clearStatsCache();
  });

  it('returns stats with correct shape on first call', async () => {
    vi.mocked(dashboardRepo.getAggregateStats).mockResolvedValue(RAW_STATS);

    const result = await dashboardService.getStats();

    expect(result.totalContacts).toBe(42);
    expect(result.totalUsers).toBe(7);
    expect(result.cachedAt).toBeTruthy();
    expect(new Date(result.cachedAt).toISOString()).toBe(result.cachedAt);
  });

  it('hits the repository exactly once on the first call', async () => {
    vi.mocked(dashboardRepo.getAggregateStats).mockResolvedValue(RAW_STATS);

    await dashboardService.getStats();

    expect(dashboardRepo.getAggregateStats).toHaveBeenCalledOnce();
  });

  it('serves subsequent calls from cache without hitting the repository', async () => {
    vi.mocked(dashboardRepo.getAggregateStats).mockResolvedValue(RAW_STATS);

    await dashboardService.getStats();
    await dashboardService.getStats();
    await dashboardService.getStats();

    expect(dashboardRepo.getAggregateStats).toHaveBeenCalledOnce();
  });

  it('returns the same cachedAt timestamp on cache hits', async () => {
    vi.mocked(dashboardRepo.getAggregateStats).mockResolvedValue(RAW_STATS);

    const first  = await dashboardService.getStats();
    const second = await dashboardService.getStats();

    expect(second.cachedAt).toBe(first.cachedAt);
  });

  it('re-fetches after cache is cleared', async () => {
    vi.mocked(dashboardRepo.getAggregateStats).mockResolvedValue(RAW_STATS);

    await dashboardService.getStats();
    dashboardService.clearStatsCache();
    await dashboardService.getStats();

    expect(dashboardRepo.getAggregateStats).toHaveBeenCalledTimes(2);
  });

  it('re-fetches after TTL expiry (mocked timers)', async () => {
    vi.useFakeTimers();
    vi.mocked(dashboardRepo.getAggregateStats).mockResolvedValue(RAW_STATS);

    await dashboardService.getStats();
    vi.advanceTimersByTime(31_000); // past 30s TTL
    await dashboardService.getStats();

    expect(dashboardRepo.getAggregateStats).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('propagates repository errors', async () => {
    vi.mocked(dashboardRepo.getAggregateStats).mockRejectedValue(
      new Error('DB connection lost')
    );

    await expect(dashboardService.getStats()).rejects.toThrow('DB connection lost');
  });
});

describe('dashboardService.getRecentActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted activity entries', async () => {
    vi.mocked(dashboardRepo.getRecentAuditActivity).mockResolvedValue(RAW_ACTIVITY);

    const result = await dashboardService.getRecentActivity();

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      id:       'log-id-1',
      action:   'CREATE',
      entity:   'auth_login',
      entityId: 'user-id-1',
      userId:   'user-id-1',
      userName: 'Admin User',
    });
    expect(result.data[0]!.createdAt).toBe('2026-06-05T10:00:00.000Z');
  });

  it('always calls the repository (no cache)', async () => {
    vi.mocked(dashboardRepo.getRecentAuditActivity).mockResolvedValue(RAW_ACTIVITY);

    await dashboardService.getRecentActivity();
    await dashboardService.getRecentActivity();

    expect(dashboardRepo.getRecentAuditActivity).toHaveBeenCalledTimes(2);
  });

  it('defaults limit to 20', async () => {
    vi.mocked(dashboardRepo.getRecentAuditActivity).mockResolvedValue([]);

    await dashboardService.getRecentActivity();

    expect(dashboardRepo.getRecentAuditActivity).toHaveBeenCalledWith(20);
  });

  it('clamps limit to a maximum of 50', async () => {
    vi.mocked(dashboardRepo.getRecentAuditActivity).mockResolvedValue([]);

    await dashboardService.getRecentActivity(999);

    expect(dashboardRepo.getRecentAuditActivity).toHaveBeenCalledWith(50);
  });

  it('clamps limit to a minimum of 1', async () => {
    vi.mocked(dashboardRepo.getRecentAuditActivity).mockResolvedValue([]);

    await dashboardService.getRecentActivity(0);

    expect(dashboardRepo.getRecentAuditActivity).toHaveBeenCalledWith(1);
  });

  it('handles entries where the user has been deleted (userId null)', async () => {
    vi.mocked(dashboardRepo.getRecentAuditActivity).mockResolvedValue([
      {
        id:        'log-id-3',
        action:    'DELETE',
        entity:    'contacts',
        entityId:  'contact-id-2',
        userId:    null,
        userName:  null,
        createdAt: new Date('2026-06-05T08:00:00Z'),
      },
    ]);

    const result = await dashboardService.getRecentActivity(1);

    expect(result.data[0]).toMatchObject({ userId: null, userName: null });
  });

  it('returns an empty array when there are no logs', async () => {
    vi.mocked(dashboardRepo.getRecentAuditActivity).mockResolvedValue([]);

    const result = await dashboardService.getRecentActivity();

    expect(result.data).toEqual([]);
  });
});
