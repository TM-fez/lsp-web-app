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
  // (R4 3a) The cockpit lists who owes what, invoice by invoice — it is the invoice ledger
  // seen from the top, so it follows invoices.read rather than reports.read. Operations
  // keeps reports and trends but no longer sees the money documents (migration 083).
  router.get('/receivables', authorize('invoices.read'), requireActiveProperty, controller.receivables);

  router.get('/cancelled-with-money', authorize('invoices.read'), requireActiveProperty, controller.heldOnCancelled);

  return router;
}
