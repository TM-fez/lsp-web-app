import type { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';
import { db } from '../../config/db.js';
import { ChannelRepository } from './channel.repository.js';
import { ChannelImportService } from './channel.import.service.js';

/**
 * Handler for the scheduled Booking.com import poll. Mirrors the existing /cron/sweep
 * pattern: secret-guarded (CRON_SECRET), refuses everyone when the secret is unset, and
 * is meant to be hit by the platform scheduler — not by RBAC users.
 *
 * Mounted in cron.routes.ts. Since the paid always-on Render plan, the 15-min poll runs
 * in-process off the scheduler (see createChannelSyncSweeper) rather than an external
 * cron, so this endpoint is now the MANUAL/fallback trigger — for forcing a poll without
 * waiting out the interval, and for a serverless host that cannot hold a timer. Both
 * paths are safe to use together: runImport() takes a cluster-wide advisory lock, so
 * whichever loses reports ran:false and does nothing.
 */
export function createChannelSyncHandler() {
  const service = new ChannelImportService(new ChannelRepository(db));

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
        return res.status(401).json({ statusCode: 401, error: 'Unauthorized', message: 'Invalid cron secret' });
      }
      const summary = await service.runImport();
      res.json({ ok: true, ...summary });
    } catch (err) {
      next(err);
    }
  };
}
