import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/modules/dashboard/dashboard.repository.js', () => ({
  getAggregateStats:      vi.fn(),
}));

import * as dashboardRepo    from '../../src/modules/dashboard/dashboard.repository.js';
import * as dashboardService from '../../src/modules/dashboard/dashboard.service.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RAW_STATS = {
  totalContacts:      42,
  totalUsers:         7,
};

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
