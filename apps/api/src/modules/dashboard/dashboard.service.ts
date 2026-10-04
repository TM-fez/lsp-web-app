import * as dashboardRepo from './dashboard.repository.js';
import type {
  DashboardStats,
  StatsCacheEntry,
  StatsScope,
} from './dashboard.types.js';

// ── Cache ─────────────────────────────────────────────────────────────────────

const STATS_TTL_MS = 30_000;
const STATS_KEY    = 'dashboard:stats';

const cache = new Map<string, StatsCacheEntry>();

// (Round 4) One cache entry for the house-wide numbers, and one PER USER for anyone whose
// numbers are limited to their properties — a single shared entry would hand one person's
// scope to the next caller.
function keyFor(scope?: StatsScope): string {
  return !scope || scope.allProperties ? STATS_KEY : `${STATS_KEY}:user:${scope.userId}`;
}

function getCachedStats(key: string): DashboardStats | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedStats(key: string, data: DashboardStats): void {
  cache.set(key, { data, expiresAt: Date.now() + STATS_TTL_MS });
}

/** Exposed for tests — resets the in-process cache. */
export function clearStatsCache(): void {
  cache.clear();
}

// ── Service methods ───────────────────────────────────────────────────────────

/**
 * Returns KPI stats.
 * Serves from cache for up to 30 seconds; cold-fetches on miss or expiry.
 * `cachedAt` reflects when the underlying data was last computed.
 */
export async function getStats(scope?: StatsScope): Promise<DashboardStats> {
  const key = keyFor(scope);
  const cached = getCachedStats(key);
  if (cached) return cached;

  const raw = await dashboardRepo.getAggregateStats(scope);

  const stats: DashboardStats = {
    totalContacts:      raw.totalContacts,
    totalUsers:         raw.totalUsers,
    cachedAt:           new Date().toISOString(),
  };

  setCachedStats(key, stats);
  return stats;
}
