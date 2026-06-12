import { Router } from 'express';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';
import { MaintenanceRepository } from './maintenance.repository.js';
import { FilesRepository } from '../files/files.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';

export function createMaintenanceRouter(): Router {
  const router = Router();
  
  const repo = new MaintenanceRepository(db);
  const filesRepo = new FilesRepository(db);
  const service = new MaintenanceService(repo, filesRepo);
  const controller = new MaintenanceController(service);

  router.use(authenticate);

  router.get('/', authorize('maintenance.read'), controller.list);
  router.get('/:id', authorize('maintenance.read'), controller.get);
  router.post('/', authorize('maintenance.create'), controller.create);
  router.patch('/:id', authorize('maintenance.update'), controller.update);
  router.patch('/:id/assign', authorize('maintenance.update'), controller.assign);
  router.patch('/:id/cost', authorize('maintenance.update'), controller.setCost);
  router.post('/:id/start', authorize('maintenance.update'), controller.start);
  router.post('/:id/complete', authorize('maintenance.complete'), controller.complete);
  router.post('/:id/approve', authorize('maintenance.approve'), controller.approve);
  router.post('/:id/cancel', authorize('maintenance.update'), controller.cancel);

  return router;
}
