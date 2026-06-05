import { Router } from 'express';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsRepository } from './reservations.repository';
import { db } from '../../db'; 
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';

export function createReservationsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new ReservationsRepository(dbInstance);
  const service = new ReservationsService(repository);
  const controller = new ReservationsController(service);

  router.use(authenticate);

  router.get('/availability', authorize('reservations.read'), controller.checkAvailability);
  router.get('/', authorize('reservations.read'), controller.getReservations);
  router.get('/:id', authorize('reservations.read'), controller.getReservationById);
  
  router.post('/', authorize('reservations.create'), controller.createReservation);
  
  router.patch('/:id', authorize('reservations.update'), controller.modifyReservation);
  
  // Specific endpoint for cancellation could be POST /:id/cancel or DELETE /:id
  router.delete('/:id', authorize('reservations.delete'), controller.cancelReservation);

  return router;
}
