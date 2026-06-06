import { Router } from 'express';
import { HoldsController } from './holds.controller.js';
import { HoldsService } from './holds.service.js';
import { HoldsRepository } from './holds.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { QuotesRepository } from '../quotes/quotes.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateHoldSchema, ReleaseHoldSchema } from './holds.types.js';

export function createHoldsRouter(dbInstance = db): Router {
  const router = Router();
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const quotes = new QuotesService(new QuotesRepository(dbInstance), pricing);
  const service = new HoldsService(new HoldsRepository(dbInstance), quotes);
  const controller = new HoldsController(service);

  router.use(authenticate);

  router.post('/sweep/release-expired', authorize('holds.update'), controller.sweepExpired);
  router.get('/', authorize('holds.read'), controller.list);
  router.get('/:id', authorize('holds.read'), controller.get);
  router.post('/', authorize('holds.create'), validateBody(CreateHoldSchema), controller.create);
  router.post('/:id/confirm', authorize('holds.update'), controller.confirm);
  router.post('/:id/release', authorize('holds.update'), validateBody(ReleaseHoldSchema), controller.release);
  router.post('/:id/retry', authorize('holds.update'), controller.retry);

  return router;
}
