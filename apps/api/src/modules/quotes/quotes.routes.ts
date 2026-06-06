import { Router } from 'express';
import { QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';
import { QuotesRepository } from './quotes.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateQuoteSchema } from './quotes.types.js';

export function createQuotesRouter(dbInstance = db): Router {
  const router = Router();
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const repository = new QuotesRepository(dbInstance);
  const service = new QuotesService(repository, pricing);
  const controller = new QuotesController(service);

  router.use(authenticate);

  router.get('/', authorize('quotes.read'), controller.list);
  router.get('/:id', authorize('quotes.read'), controller.get);
  router.post('/', authorize('quotes.create'), validateBody(CreateQuoteSchema), controller.create);

  return router;
}
