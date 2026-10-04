import type { DashboardStats, ActivityEntry, DashboardActivityResponse } from '@lsp/shared-types';

// ── Re-exports for module consumers ───────────────────────────────────────────
export type { DashboardStats, ActivityEntry, DashboardActivityResponse };

/**
 * (Round 4) Whose numbers these are. `allProperties` (admin, or a member of every property)
 * gets the house-wide counts; anyone else gets counts limited to their own properties.
 */
export interface StatsScope {
  userId: string;
  ids: string[] | null;
  allProperties: boolean;
}

// ── Raw repository row types ──────────────────────────────────────────────────

/** Raw count values returned directly from aggregate DB queries. */
export interface RawStatsRow {
  totalContacts: number;
  totalUsers: number;
}

/** Raw audit log row joined with the acting user's name. */
export interface RawActivityRow {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
}

// ── Cache internals ───────────────────────────────────────────────────────────

export interface StatsCacheEntry {
  data: DashboardStats;
  expiresAt: number;
}
