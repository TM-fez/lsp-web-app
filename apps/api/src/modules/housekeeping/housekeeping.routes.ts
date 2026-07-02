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

  // Compliance checklist — the company cleaning standard. Reading it is
  // property-independent; editing the standard is a manager action.
  // (Registered BEFORE /:id so "checklist"/"turnaround" aren't taken for task ids.)
  router.get('/checklist', authorize('housekeeping.read'), controller.checklist);
  router.post('/checklist', authorize('housekeeping.signoff'), controller.addChecklistItem);
  router.patch('/checklist/:itemId', authorize('housekeeping.signoff'), controller.updateChecklistItem);

  // Turnaround KPI: avg DIRTY → READY minutes for the active property.
  router.get('/turnaround', authorize('housekeeping.read'), requireActiveProperty, controller.turnaround);

  router.get('/:id', authorize('housekeeping.read'), requireActiveProperty, taskInActiveProperty, controller.get);

  // Unit-keyed three-stage turn workflow (Phase 3), each scoped to the active property:
  //   DIRTY -> CLEANING     Routine Checks — cleaners (housekeeping.update)
  //   CLEANING -> INSPECTED Supervisor validation — leads/supervisors (housekeeping.inspect)
  //   INSPECTED -> READY    Property Manager sign-off — managers (housekeeping.signoff)
  router.post('/rooms/:roomId/start', authorize('housekeeping.update'), requireActiveProperty, roomInActiveProperty, controller.start);
  router.post('/rooms/:roomId/inspect', authorize('housekeeping.update', 'housekeeping.inspect'), requireActiveProperty, roomInActiveProperty, controller.inspect);
  router.post('/rooms/:roomId/ready', authorize('housekeeping.signoff'), requireActiveProperty, roomInActiveProperty, controller.ready);

  // Per-turn checklist state: the cleaner ticks items while the unit is CLEANING;
  // inspect (stage 2) refuses until every active item is ticked.
  router.get('/rooms/:roomId/checks', authorize('housekeeping.read'), requireActiveProperty, roomInActiveProperty, controller.roomChecks);
  router.post('/rooms/:roomId/checks', authorize('housekeeping.update'), requireActiveProperty, roomInActiveProperty, controller.setRoomCheck);

  return router;
}
