import { Router, type Request, type Response, type NextFunction } from 'express';
import { env } from '../../config/env.js';
import { createSweeper } from '../../core/scheduler.js';
import { db } from '../../config/db.js';
import { runReminders } from '../notifications/reminders.js';
import { createChannelSyncHandler } from '../channel/channel.cron.js';

/**
 * Scheduled jobs triggered by the platform's cron (e.g. Vercel Cron) instead of the
 * in-process setInterval an always-on server uses. Every endpoint is guarded by a
 * shared secret so only the cron can call it — refuses everyone when CRON_SECRET is
 * unset.
 *
 * - /sweep     — auto-expire holds + stale quotes (housekeeping; expiry is also
 *                enforced at point-of-use, so this is not the safety net).
 * - /reminders — raise interval reminder notifications (checkouts due, stale repairs).
 *                Idempotent per day, so it's safe on any cadence; run it daily.
 */

/** Shared-secret guard: true when the caller presented the configured CRON_SECRET. */
function cronAuthorized(req: Request): boolean {
  const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  return Boolean(env.CRON_SECRET) && provided === env.CRON_SECRET;
}

export function createCronRouter(): Router {
  const router = Router();
  const sweep = createSweeper();

  router.get('/sweep', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!cronAuthorized(req)) {
        return res.status(401).json({ statusCode: 401, error: 'Unauthorized', message: 'Invalid cron secret' });
      }
      res.json({ ok: true, ...(await sweep()) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/reminders', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!cronAuthorized(req)) {
        return res.status(401).json({ statusCode: 401, error: 'Unauthorized', message: 'Invalid cron secret' });
      }
      res.json({ ok: true, ...(await runReminders(db)) });
    } catch (err) {
      next(err);
    }
  });

  // Booking.com iCal import poll (H4). Mounting is safe before go-live: the handler
  // refuses every caller without CRON_SECRET, and with no rooms configured it is a
  // no-op. Going live = adding the 15-min platform trigger (Render Cron / GH Action)
  // that GETs this with Authorization: Bearer <CRON_SECRET>.
  router.get('/channel-sync', createChannelSyncHandler());

  return router;
}
