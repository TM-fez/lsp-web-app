import { Router } from 'express';
import { OperatingExpensesController } from './operating-expenses.controller.js';
import { OperatingExpensesService } from './operating-expenses.service.js';
import { OperatingExpensesRepository } from './operating-expenses.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import {
  CreateOperatingExpenseSchema,
  UpdateOperatingExpenseSchema,
} from './operating-expenses.types.js';

export function createOperatingExpensesRouter(dbInstance = db): Router {
  const router = Router();
  const service = new OperatingExpensesService(new OperatingExpensesRepository(dbInstance));
  const controller = new OperatingExpensesController(service);

  router.use(authenticate);

  router.get('/', authorize('opex.read'), controller.list);
  router.get('/:id', authorize('opex.read'), controller.get);
  router.post('/', authorize('opex.create'), validateBody(CreateOperatingExpenseSchema), controller.create);
  router.patch('/:id', authorize('opex.update'), validateBody(UpdateOperatingExpenseSchema), controller.update);
  router.delete('/:id', authorize('opex.delete'), controller.remove);

  return router;
}
