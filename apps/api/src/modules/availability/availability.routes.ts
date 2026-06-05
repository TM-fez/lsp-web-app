import { Router } from 'express';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';
import { AvailabilityRepository } from './availability.repository.js';
import { db } from '../../db/index.js'; 
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';

export function createAvailabilityRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new AvailabilityRepository(dbInstance);
  const service = new AvailabilityService(repository);
  const controller = new AvailabilityController(service);

  router.use(authenticate);

  // permission migration: ensure proper scopes are used
  router.get('/', authorize('availability.read'), controller.getRoomAvailability);
  router.get('/rooms', authorize('availability.read'), controller.getAvailableRooms);
  router.get('/calendar', authorize('availability.read'), controller.getCalendar);
  router.post('/quote', authorize('availability.read'), controller.getQuote);

  return router;
}
