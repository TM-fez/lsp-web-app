import { Router } from 'express';
import { HousekeepingController } from './housekeeping.controller.js';
import { HousekeepingService } from './housekeeping.service.js';
import { HousekeepingRepository } from './housekeeping.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';
import { AppError } from '../../core/errors/AppError.js';
import type { Request, Response, NextFunction } from 'express';

export function createHousekeepingRouter(): Router {
  const router = Router();

  const repo = new HousekeepingRepository(db);
  const service = new HousekeepingService(repo);
  const controller = new HousekeepingController(service);

  // By-id scope guards: a task / unit outside the active property is "not found".
  const taskInActiveProperty = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const pid = await repo.taskPropertyId(req.params.id as string);
      if (pid !== req.activePropertyId) return next(AppError.notFound('Housekeeping task not found'));
      next();
    } catch (err) {
      next(err);
    }
  };
  const roomInActiveProperty = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const pid = await repo.roomPropertyId(req.params.roomId as string);
      if (pid !== req.activePropertyId) return next(AppError.notFound('Room not found'));
      next();
    } catch (err) {
      next(err);
    }
  };

  router.use(authenticate);

  // Queue + list are scoped to the active property (the housekeeping page + cockpit feed).
  router.get('/queue', authorize('housekeeping.read'), requireActiveProperty, controller.queue);
  router.get('/', authorize('housekeeping.read'), requireActiveProperty, controller.list);
  router.get('/:id', authorize('housekeeping.read'), requireActiveProperty, taskInActiveProperty, controller.get);

  // Unit-keyed turn workflow: DIRTY -> CLEANING -> INSPECTED -> READY. Each is scoped
  // to the active property. Inspection is the approval step: cleaners (base housekeeping
  // role) start cleans and mark ready; only leads/supervisors carry housekeeping.inspect.
  router.post('/rooms/:roomId/start', authorize('housekeeping.update'), requireActiveProperty, roomInActiveProperty, controller.start);
  router.post('/rooms/:roomId/inspect', authorize('housekeeping.update', 'housekeeping.inspect'), requireActiveProperty, roomInActiveProperty, controller.inspect);
  router.post('/rooms/:roomId/ready', authorize('housekeeping.update'), requireActiveProperty, roomInActiveProperty, controller.ready);

  return router;
}
