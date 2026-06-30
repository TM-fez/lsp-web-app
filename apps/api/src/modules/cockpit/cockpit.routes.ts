import { Router } from 'express';
import { CockpitController } from './cockpit.controller.js';
import { CockpitService } from './cockpit.service.js';
import { CockpitRepository } from './cockpit.repository.js';
import { HousekeepingRepository } from '../housekeeping/housekeeping.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';

export function createCockpitRouter(): Router {
  const router = Router();

  const service = new CockpitService(new CockpitRepository(db), new HousekeepingRepository(db));
  const controller = new CockpitController(service);

  router.use(authenticate);
  router.get('/board', authorize('cockpit.read'), requireActiveProperty, controller.board);

  return router;
}
