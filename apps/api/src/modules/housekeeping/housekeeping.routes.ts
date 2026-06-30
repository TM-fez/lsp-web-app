import { Router } from 'express';
import { HousekeepingController } from './housekeeping.controller.js';
import { HousekeepingService } from './housekeeping.service.js';
import { HousekeepingRepository } from './housekeeping.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';

export function createHousekeepingRouter(): Router {
  const router = Router();

  const repo = new HousekeepingRepository(db);
  const service = new HousekeepingService(repo);
  const controller = new HousekeepingController(service);

  router.use(authenticate);

  // Queue + list are scoped to the active property (the housekeeping page + cockpit feed).
  router.get('/queue', authorize('housekeeping.read'), requireActiveProperty, controller.queue);
  router.get('/', authorize('housekeeping.read'), requireActiveProperty, controller.list);
  router.get('/:id', authorize('housekeeping.read'), controller.get);

  // Unit-keyed turn workflow: DIRTY -> CLEANING -> INSPECTED -> READY.
  // Inspection is the approval step: cleaners (base housekeeping role) start cleans
  // and mark ready; only leads/supervisors carry housekeeping.inspect.
  router.post('/rooms/:roomId/start', authorize('housekeeping.update'), controller.start);
  router.post('/rooms/:roomId/inspect', authorize('housekeeping.update', 'housekeeping.inspect'), controller.inspect);
  router.post('/rooms/:roomId/ready', authorize('housekeeping.update'), controller.ready);

  return router;
}
