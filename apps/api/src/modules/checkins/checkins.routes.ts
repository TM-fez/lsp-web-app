import { Router } from 'express';
import { CheckinsController } from './checkins.controller.js';
import { CheckinsService } from './checkins.service.js';
import { CheckinsRepository } from './checkins.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';
import { requireInActiveProperty, requireBodyRefInActiveProperty, propertyOfOccupancy, propertyOfReservation } from '../../core/scope/propertyOf.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateCheckInSchema, CheckOutSchema } from './checkins.types.js';

export function createCheckinsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new CheckinsRepository(dbInstance);
  const service = new CheckinsService(repository);
  const controller = new CheckinsController(service);

  router.use(authenticate);

  // H5 property scoping: occupancy is per-room, so it scopes cleanly.
  const inProperty = requireInActiveProperty(dbInstance, propertyOfOccupancy, 'Occupancy');
  const reservationRefInProperty = requireBodyRefInActiveProperty(dbInstance, 'reservation_id', propertyOfReservation, 'Reservation');

  router.get('/active', authorize('checkins.read'), requireActiveProperty, controller.listActive);
  router.get('/', authorize('checkins.read'), requireActiveProperty, controller.listOccupancy);
  router.get('/:id', authorize('checkins.read'), requireActiveProperty, inProperty, controller.getOccupancyById);

  router.post('/', authorize('checkins.create'), requireActiveProperty, reservationRefInProperty, validateBody(CreateCheckInSchema), controller.checkIn);

  router.post('/:id/checkout', authorize('checkins.update'), requireActiveProperty, inProperty, validateBody(CheckOutSchema), controller.checkOut);

  return router;
}
