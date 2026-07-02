import { Router } from 'express';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PaymentsRepository } from './payments.repository.js';
import { HoldsRepository } from '../holds/holds.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { QuotesRepository } from '../quotes/quotes.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';
import { requireInActiveProperty, requireBodyRefInActiveProperty, propertyOfPaymentIntent, propertyOfHold } from '../../core/scope/propertyOf.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreatePaymentIntentSchema, AttemptPaymentSchema } from './payments.types.js';

export function createPaymentsRouter(dbInstance = db): Router {
  const router = Router();
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const quotes = new QuotesService(new QuotesRepository(dbInstance), pricing);
  const service = new PaymentsService(new PaymentsRepository(dbInstance), new HoldsRepository(dbInstance), quotes);
  const controller = new PaymentsController(service);

  router.use(authenticate);

  // H5 property scoping: money data never crosses the active-property boundary.
  const inProperty = requireInActiveProperty(dbInstance, propertyOfPaymentIntent, 'Payment');
  const holdRefInProperty = requireBodyRefInActiveProperty(dbInstance, 'hold_id', propertyOfHold, 'Hold');

  router.get('/', authorize('payments.read'), requireActiveProperty, controller.list);
  router.get('/:id', authorize('payments.read'), requireActiveProperty, inProperty, controller.get);
  router.post('/', authorize('payments.create'), validateBody(CreatePaymentIntentSchema), requireActiveProperty, holdRefInProperty, controller.create);
  router.post('/:id/attempt', authorize('payments.update'), requireActiveProperty, inProperty, validateBody(AttemptPaymentSchema), controller.attempt);

  return router;
}
