import { Router } from 'express';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { FinanceRepository } from './finance.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';

export function createFinanceRouter(dbInstance = db): Router {
  const router = Router();
  const service = new FinanceService(new FinanceRepository(dbInstance));
  const controller = new FinanceController(service);

  router.use(authenticate);
  // Shares the management/dashboard permission with reports (A5 Dashboards).
  router.get('/receivables', authorize('reports.read'), requireActiveProperty, controller.receivables);

  router.get('/cancelled-with-money', authorize('reports.read'), requireActiveProperty, controller.heldOnCancelled);

  return router;
}
