import { Router } from 'express';
import { ReservationsController } from './reservations.controller.js';
import { ReservationsService } from './reservations.service.js';
import { ReservationsRepository } from './reservations.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateReservationSchema, UpdateReservationSchema } from './reservations.types.js';

export function createReservationsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new ReservationsRepository(dbInstance);
  const service = new ReservationsService(repository);
  const controller = new ReservationsController(service);

  router.use(authenticate);

  router.get('/availability', authorize('reservations.read'), controller.checkAvailability);
  router.get('/', authorize('reservations.read'), controller.getReservations);
  router.get('/:id', authorize('reservations.read'), controller.getReservationById);
  
  router.post('/', authorize('reservations.create'), validateBody(CreateReservationSchema), controller.createReservation);

  router.patch('/:id', authorize('reservations.update'), validateBody(UpdateReservationSchema), controller.modifyReservation);
  
  // Specific endpoint for cancellation could be POST /:id/cancel or DELETE /:id
  router.delete('/:id', authorize('reservations.delete'), controller.cancelReservation);

  return router;
}
