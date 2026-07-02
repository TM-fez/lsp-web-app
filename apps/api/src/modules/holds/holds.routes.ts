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
import { requireActiveProperty } from '../../core/scope/activeProperty.js';
import { requireInActiveProperty, requireBodyRefInActiveProperty, propertyOfHold, propertyOfRoom, propertyOfReservation } from '../../core/scope/propertyOf.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateHoldSchema, ReleaseHoldSchema } from './holds.types.js';

export function createHoldsRouter(dbInstance = db): Router {
  const router = Router();
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const quotes = new QuotesService(new QuotesRepository(dbInstance), pricing);
  const service = new HoldsService(new HoldsRepository(dbInstance), quotes);
  const controller = new HoldsController(service);

  router.use(authenticate);

  // H5 property scoping: lists filter to the active property; by-id routes 404 for
  // entities outside it; creates validate any room/reservation reference. The sweep
  // stays global — it is operational housekeeping, not a data read.
  const inProperty = requireInActiveProperty(dbInstance, propertyOfHold, 'Hold');
  const roomRefInProperty = requireBodyRefInActiveProperty(dbInstance, 'room_id', propertyOfRoom, 'Room');
  const reservationRefInProperty = requireBodyRefInActiveProperty(dbInstance, 'reservation_id', propertyOfReservation, 'Reservation');

  router.post('/sweep/release-expired', authorize('holds.update'), controller.sweepExpired);
  router.get('/', authorize('holds.read'), requireActiveProperty, controller.list);
  router.get('/:id', authorize('holds.read'), requireActiveProperty, inProperty, controller.get);
  router.post('/', authorize('holds.create'), validateBody(CreateHoldSchema), requireActiveProperty, roomRefInProperty, reservationRefInProperty, controller.create);
  router.post('/:id/confirm', authorize('holds.update'), requireActiveProperty, inProperty, controller.confirm);
  router.post('/:id/release', authorize('holds.update'), requireActiveProperty, inProperty, validateBody(ReleaseHoldSchema), controller.release);
  router.post('/:id/retry', authorize('holds.update'), requireActiveProperty, inProperty, controller.retry);

  return router;
}
