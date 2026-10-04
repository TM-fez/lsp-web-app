import { Router } from 'express';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';
import { PricingRepository } from './pricing.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { requireAllProperties } from '../../core/scope/propertyScope.js';
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
  // (R4 2a) Rate plans are estate-wide, so changing one is for an admin or someone who
  // works across every property — not a manager limited to some of them.
  const estateWide = requireAllProperties(
    'Room rates apply to every property, so only an admin or someone who works across all properties can change them.',
    dbInstance
  );

  router.post('/', authorize('pricing.create'), estateWide, validateBody(CreateRatePlanSchema), controller.create);
  router.patch('/:id', authorize('pricing.update'), estateWide, validateBody(UpdateRatePlanSchema), controller.update);
  router.delete('/:id', authorize('pricing.update'), estateWide, controller.remove);

  return router;
}
