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
 * NOT yet mounted or scheduled — held for review per the build plan. To wire it:
 *   1. mount in cron.routes.ts:  router.get('/channel-sync', createChannelSyncHandler());
 *   2. add the 15-min trigger (Render Cron Job / GitHub Action) that GETs it with the
 *      Authorization: Bearer <CRON_SECRET> header.
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
