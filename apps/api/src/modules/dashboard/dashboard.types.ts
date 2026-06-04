import type { DashboardStats, ActivityEntry, DashboardActivityResponse } from '@lsp/shared-types';

// ── Re-exports for module consumers ───────────────────────────────────────────
export type { DashboardStats, ActivityEntry, DashboardActivityResponse };

// ── Raw repository row types ──────────────────────────────────────────────────

/** Raw count values returned directly from aggregate DB queries. */
export interface RawStatsRow {
  totalContacts: number;
  totalUsers: number;
  activeFeatureFlags: number;
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
