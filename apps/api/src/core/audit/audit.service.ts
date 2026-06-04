import { db } from '../../config/db.js';
import type { NewAuditLog } from '../../db/types.js';

/**
 * Writes a single audit log entry.
 * Failures are swallowed — audit logging must never crash a request.
 */
export async function writeAuditLog(entry: NewAuditLog): Promise<void> {
  try {
    await db.insertInto('audit_logs').values(entry).execute();
  } catch (err) {
    // Log to stderr only — do not propagate
    console.error('[audit] write failed:', err);
  }
}
