import { Router, type Request, type Response, type NextFunction } from 'express';
import { env } from '../../config/env.js';
import { createSweeper } from '../../core/scheduler.js';

/**
 * Scheduled auto-expiry sweep, triggered by the platform's cron (e.g. Vercel Cron)
 * instead of the in-process setInterval an always-on server uses. Guarded by a shared
 * secret so only the cron can call it — refuses everyone when CRON_SECRET is unset.
 *
 * Expiry is still enforced at point-of-use (a stale hold/quote can't be consumed), so
 * this sweep is housekeeping, not the safety net — fine to run as infrequently as daily.
 */
export function createCronRouter(): Router {
  const router = Router();
  const sweep = createSweeper();

  router.get('/sweep', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
        return res.status(401).json({ statusCode: 401, error: 'Unauthorized', message: 'Invalid cron secret' });
      }
      res.json({ ok: true, ...(await sweep()) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
