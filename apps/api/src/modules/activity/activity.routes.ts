import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { ActivityService } from './activity.service.js';
import { ActivityRepository } from './activity.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';

export function createActivityRouter(): Router {
  const router = Router();
  const service = new ActivityService(new ActivityRepository(db));

  // The shared "what's changed" feed — every STAFF role can see it (names + plain
  // phrases only), so a price change isn't a surprise to anyone. Gated on activity.read
  // (migration 066), which every role except `contractor` holds: contractors are
  // external people whose world is their own work orders, and `authenticate` alone put
  // the whole house's feed one request away from them.
  router.use(authenticate);
  // requireActiveProperty (D03): the feed is scoped to the property the user is working
  // in. Safe to require here — the cockpit board this panel sits beside already requires
  // it, so a request without the header is one where the page is already failing. It is
  // also the single enforcement point that stops a forged X-Property-Id, since it checks
  // membership before attaching the id.
  router.get('/', authorize('activity.read'), requireActiveProperty, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 50);
      res.json({ data: await service.recent(limit, req.activePropertyId) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
