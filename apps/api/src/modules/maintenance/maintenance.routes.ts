import { Router } from 'express';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';
import { MaintenanceRepository } from './maintenance.repository.js';
import { FilesRepository } from '../files/files.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';
import { AppError } from '../../core/errors/AppError.js';
import type { Request, Response, NextFunction } from 'express';

export function createMaintenanceRouter(): Router {
  const router = Router();

  const repo = new MaintenanceRepository(db);
  const filesRepo = new FilesRepository(db);
  const service = new MaintenanceService(repo, filesRepo);
  const controller = new MaintenanceController(service);

  // By-id scope guard: a work order outside the active property is "not found".
  const inActiveProperty = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const pid = await repo.workOrderPropertyId(req.params.id as string);
      if (pid !== req.activePropertyId) return next(AppError.notFound('Work order not found'));
      next();
    } catch (err) {
      next(err);
    }
  };

  router.use(authenticate);

  // The work-order list is scoped to the active property (the maintenance page).
  router.get('/', authorize('maintenance.read'), requireActiveProperty, controller.list);
  router.post('/', authorize('maintenance.create'), controller.create);

  // Every by-id route is scoped to the active property.
  router.get('/:id', authorize('maintenance.read'), requireActiveProperty, inActiveProperty, controller.get);
  router.patch('/:id', authorize('maintenance.update'), requireActiveProperty, inActiveProperty, controller.update);
  router.patch('/:id/assign', authorize('maintenance.update'), requireActiveProperty, inActiveProperty, controller.assign);
  router.patch('/:id/cost', authorize('maintenance.update'), requireActiveProperty, inActiveProperty, controller.setCost);
  router.post('/:id/start', authorize('maintenance.update'), requireActiveProperty, inActiveProperty, controller.start);
  router.post('/:id/complete', authorize('maintenance.complete'), requireActiveProperty, inActiveProperty, controller.complete);
  router.post('/:id/approve', authorize('maintenance.approve'), requireActiveProperty, inActiveProperty, controller.approve);
  router.post('/:id/cancel', authorize('maintenance.update'), requireActiveProperty, inActiveProperty, controller.cancel);

  return router;
}
