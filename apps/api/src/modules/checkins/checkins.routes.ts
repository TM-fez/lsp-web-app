import { Router } from 'express';
import { CheckinsController } from './checkins.controller.js';
import { CheckinsService } from './checkins.service.js';
import { CheckinsRepository } from './checkins.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateCheckInSchema, CheckOutSchema } from './checkins.types.js';

export function createCheckinsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new CheckinsRepository(dbInstance);
  const service = new CheckinsService(repository);
  const controller = new CheckinsController(service);

  router.use(authenticate);

  router.get('/active', authorize('checkins.read'), controller.listActive);
  router.get('/', authorize('checkins.read'), controller.listOccupancy);
  router.get('/:id', authorize('checkins.read'), controller.getOccupancyById);

  router.post('/', authorize('checkins.create'), validateBody(CreateCheckInSchema), controller.checkIn);

  router.post('/:id/checkout', authorize('checkins.update'), validateBody(CheckOutSchema), controller.checkOut);

  return router;
}
