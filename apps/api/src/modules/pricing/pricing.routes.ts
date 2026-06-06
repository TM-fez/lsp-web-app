import { Router } from 'express';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';
import { PricingRepository } from './pricing.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateRatePlanSchema, UpdateRatePlanSchema } from './pricing.types.js';

export function createPricingRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new PricingRepository(dbInstance);
  const service = new PricingService(repository);
  const controller = new PricingController(service);

  router.use(authenticate);

  router.get('/preview', authorize('pricing.read'), controller.preview);
  router.get('/', authorize('pricing.read'), controller.list);
  router.get('/:id', authorize('pricing.read'), controller.get);
  router.post('/', authorize('pricing.create'), validateBody(CreateRatePlanSchema), controller.create);
  router.patch('/:id', authorize('pricing.update'), validateBody(UpdateRatePlanSchema), controller.update);
  router.delete('/:id', authorize('pricing.update'), controller.remove);

  return router;
}
