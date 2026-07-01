import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Shared singleton bound to the app `db`. Other modules import this to raise alerts
 * (`notifications.notify(...)`) without re-wiring the repo; the reminder sweep uses
 * it too. Tests construct their own instance against a test db.
 */
export const notifications = new NotificationsService(new NotificationsRepository(db));

const MarkReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'ids must contain at least one id'),
});

export function createNotificationsRouter(service: NotificationsService = notifications): Router {
  const router = Router();

  // You only ever see and touch your OWN notifications — logged in is enough, no RBAC.
  router.use(authenticate);

  // GET /notifications?unread=1&limit=30 — the bell's dropdown. Includes unread_count
  // so the badge and the list come back in one round-trip.
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
      const [data, unread_count] = await Promise.all([
        service.list(userId, { unreadOnly, limit }),
        service.unreadCount(userId),
      ]);
      res.json({ data, unread_count });
    } catch (err) {
      next(err);
    }
  });

  router.get('/unread-count', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ count: await service.unreadCount(req.user!.sub) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/read', validateBody(MarkReadSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids } = req.body as z.infer<typeof MarkReadSchema>;
      res.json({ updated: await service.markRead(req.user!.sub, ids) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ updated: await service.markAllRead(req.user!.sub) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
