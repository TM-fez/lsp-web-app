import { Router } from 'express';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { ReportsRepository } from './reports.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';

export function createReportsRouter(dbInstance = db): Router {
  const router = Router();
  const service = new ReportsService(new ReportsRepository(dbInstance));
  const controller = new ReportsController(service);

  router.use(authenticate);
  router.get('/pnl', authorize('reports.read'), controller.pnl);

  return router;
}
