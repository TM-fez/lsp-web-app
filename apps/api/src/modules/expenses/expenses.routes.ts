import { Router } from 'express';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';
import { ExpensesRepository } from './expenses.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';

export function createExpensesRouter(): Router {
  const router = Router();
  const repo = new ExpensesRepository(db);
  const service = new ExpensesService(repo);
  const controller = new ExpensesController(service);

  router.use(authenticate);

  // Accounts can see + reconcile; managers approve the spend. None of these need
  // maintenance access — the team separation holds.
  router.get('/', authorize('expenses.read'), controller.list);
  router.post('/:id/approve', authorize('expenses.approve'), controller.approve);
  router.post('/:id/reconcile', authorize('expenses.reconcile'), controller.reconcile);

  return router;
}
