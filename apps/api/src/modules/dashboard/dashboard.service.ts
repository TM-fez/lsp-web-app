import * as dashboardRepo from './dashboard.repository.js';
import type {
  DashboardStats,
  DashboardActivityResponse,
  StatsCacheEntry,
} from './dashboard.types.js';

// ── Cache ─────────────────────────────────────────────────────────────────────

const STATS_TTL_MS = 30_000;
const STATS_KEY    = 'dashboard:stats';

const cache = new Map<string, StatsCacheEntry>();

function getCachedStats(): DashboardStats | null {
  const entry = cache.get(STATS_KEY);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(STATS_KEY);
    return null;
  }
  return entry.data;
}

function setCachedStats(data: DashboardStats): void {
  cache.set(STATS_KEY, { data, expiresAt: Date.now() + STATS_TTL_MS });
}

/** Exposed for tests — resets the in-process cache. */
export function clearStatsCache(): void {
  cache.delete(STATS_KEY);
}

// ── Service methods ───────────────────────────────────────────────────────────

/**
 * Returns KPI stats.
 * Serves from cache for up to 30 seconds; cold-fetches on miss or expiry.
 * `cachedAt` reflects when the underlying data was last computed.
 */
export async function getStats(): Promise<DashboardStats> {
  const cached = getCachedStats();
  if (cached) return cached;

  const raw = await dashboardRepo.getAggregateStats();

  const stats: DashboardStats = {
    totalContacts:      raw.totalContacts,
    totalUsers:         raw.totalUsers,
    activeFeatureFlags: raw.activeFeatureFlags,
    cachedAt:           new Date().toISOString(),
  };

  setCachedStats(stats);
  return stats;
}

/**
 * Returns the most recent audit log entries.
 * Always fetches live — activity is intentionally not cached.
 */
export async function getRecentActivity(
  limit = 20
): Promise<DashboardActivityResponse> {
  const clampedLimit = Math.min(Math.max(1, limit), 50);
  const rows = await dashboardRepo.getRecentAuditActivity(clampedLimit);

  return {
    data: rows.map((r) => ({
      id:        r.id,
      action:    r.action as 'CREATE' | 'UPDATE' | 'DELETE',
      entity:    r.entity,
      entityId:  r.entityId,
      userId:    r.userId,
      userName:  r.userName,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
