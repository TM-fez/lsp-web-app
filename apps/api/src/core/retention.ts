import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { db as defaultDb } from '../config/db.js';
import { env } from '../config/env.js';
import type { Database } from '../db/types.js';

/**
 * Data retention — the tables that only ever grow.
 *
 * refresh_tokens: every login inserts one and every refresh rotates (revokes) one, so
 * dead rows pile up forever. Pruning tokens that have been expired/revoked for longer
 * than REFRESH_TOKEN_RETENTION_DAYS changes nothing for security (they were already
 * unusable) — it just stops the table growing without bound.
 *
 * audit_logs: the business's audit trail — deleting history is a policy decision, not
 * housekeeping. So it is STRICTLY OPT-IN: AUDIT_LOG_RETENTION_DAYS defaults to 0 (keep
 * forever) and only prunes when the owner deliberately sets a window. NOTE the activity
 * feed and the channel-sync collision throttle both read audit_logs; any sane window
 * (≥ 30 days) is far beyond what they need.
 */

export interface RetentionConfig {
  /** Days a token stays after it expired / was revoked. <= 0 disables. */
  refreshTokenDays: number;
  /** Days of audit history to KEEP. 0 (default) = keep forever. */
  auditLogDays: number;
}

export interface RetentionResult {
  refreshTokensPruned: number;
  auditLogsPruned: number;
}

export interface RetentionDeps {
  /** Delete tokens unusable (expired or revoked) since before the cutoff. */
  deleteDeadRefreshTokens(cutoff: Date): Promise<number>;
  deleteOldAuditLogs(cutoff: Date): Promise<number>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runRetention(
  deps: RetentionDeps,
  cfg: RetentionConfig,
  now: Date = new Date(),
): Promise<RetentionResult> {
  const result: RetentionResult = { refreshTokensPruned: 0, auditLogsPruned: 0 };

  if (cfg.refreshTokenDays > 0) {
    result.refreshTokensPruned = await deps.deleteDeadRefreshTokens(
      new Date(now.getTime() - cfg.refreshTokenDays * DAY_MS),
    );
  }

  if (cfg.auditLogDays > 0) {
    result.auditLogsPruned = await deps.deleteOldAuditLogs(
      new Date(now.getTime() - cfg.auditLogDays * DAY_MS),
    );
  }

  return result;
}

// ── Real dependencies ─────────────────────────────────────────────────────────

function buildDeps(db: Kysely<Database>): RetentionDeps {
  return {
    async deleteDeadRefreshTokens(cutoff) {
      const res = await db
        .deleteFrom('refresh_tokens')
        .where((eb) =>
          eb.or([
            eb('expires_at', '<', cutoff),
            // revoked has no timestamp of its own; created_at is a safe upper bound
            // (a token can't be revoked before it was created).
            eb.and([eb('revoked', '=', true), eb('created_at', '<', cutoff)]),
          ]),
        )
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0);
    },

    async deleteOldAuditLogs(cutoff) {
      const res = await db
        .deleteFrom('audit_logs')
        .where(sql<boolean>`created_at < ${cutoff}`)
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0);
    },
  };
}

/**
 * The closure the sweep runs. The sweep ticks every minute, but retention only needs
 * to run daily — so it self-gates and returns zeros in between. (Per process; a
 * restart just means one extra prune, which is harmless because deletes are windowed.)
 */
export function createRetentionSweeper(
  dbInstance: Kysely<Database> = defaultDb,
  deps: RetentionDeps = buildDeps(dbInstance),
  intervalMs: number = DAY_MS,
): () => Promise<RetentionResult> {
  let lastRunMs = 0;

  return async () => {
    const nowMs = Date.now();
    if (nowMs - lastRunMs < intervalMs) {
      return { refreshTokensPruned: 0, auditLogsPruned: 0 };
    }
    lastRunMs = nowMs;
    return runRetention(deps, {
      refreshTokenDays: env.REFRESH_TOKEN_RETENTION_DAYS,
      auditLogDays: env.AUDIT_LOG_RETENTION_DAYS,
    });
  };
}
