import { Router } from 'express';
import { OperatingExpensesController } from './operating-expenses.controller.js';
import { OperatingExpensesService } from './operating-expenses.service.js';
import { OperatingExpensesRepository } from './operating-expenses.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { accessiblePropertyIdsForUser } from '../../core/scope/activeProperty.js';
import { AppError } from '../../core/errors/AppError.js';
import type { Request, Response, NextFunction } from 'express';
import {
  CreateOperatingExpenseSchema,
  UpdateOperatingExpenseSchema,
  CreateRecurringSchema,
  UpdateRecurringSchema,
  GenerateRecurringSchema,
} from './operating-expenses.types.js';

export function createOperatingExpensesRouter(dbInstance = db): Router {
  const router = Router();
  const service = new OperatingExpensesService(new OperatingExpensesRepository(dbInstance));
  const controller = new OperatingExpensesController(service);

  // (Re-test round 3) The list was scoped to the user's properties, but the by-id routes
  // were not: a CBD-only accounts user could read, edit and delete Village cost rows by
  // id, and create new ones against Village. Same rule as the list for every route:
  // admins (null) everything; anyone else only rows of their own properties. A row with
  // no property is company-wide — admin's, like the list.
  const rowInScope = (table: 'operating_expenses' | 'recurring_operating_costs') =>
    async (req: Request, _res: Response, next: NextFunction) => {
      try {
        const ids = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
        if (ids === null) return next();
        const row = await dbInstance
          .selectFrom(table)
          .select('property_id')
          .where('id', '=', req.params.id as string)
          .executeTakeFirst();
        if (!row || !row.property_id || !ids.includes(row.property_id)) {
          return next(AppError.notFound('That cost could not be found.'));
        }
        next();
      } catch (err) {
        next(err);
      }
    };
  // A create, or an edit that moves the row, must name one of the user's properties.
  const bodyPropertyInScope = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const ids = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
      if (ids === null) return next();
      const body = req.body as { property_id?: string | null };
      const isCreate = req.method === 'POST';
      if (!isCreate && !('property_id' in body)) return next();
      if (!body.property_id || !ids.includes(body.property_id)) {
        return next(AppError.forbidden('Choose one of your own properties for this cost.'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
  const opexInScope = rowInScope('operating_expenses');
  const recurringInScope = rowInScope('recurring_operating_costs');

  router.use(authenticate);

  router.get('/', authorize('opex.read'), controller.list);

  // Recurring templates — registered before '/:id' so '/recurring' isn't read as an id.
  router.get('/recurring', authorize('opex.read'), controller.listRecurring);
  router.post('/recurring', authorize('opex.create'), validateBody(CreateRecurringSchema), bodyPropertyInScope, controller.createRecurring);
  router.post('/recurring/generate', authorize('opex.create'), validateBody(GenerateRecurringSchema), controller.generate);
  router.patch('/recurring/:id', authorize('opex.update'), recurringInScope, validateBody(UpdateRecurringSchema), bodyPropertyInScope, controller.updateRecurring);
  router.delete('/recurring/:id', authorize('opex.delete'), recurringInScope, controller.removeRecurring);

  router.get('/:id', authorize('opex.read'), opexInScope, controller.get);
  router.post('/', authorize('opex.create'), validateBody(CreateOperatingExpenseSchema), bodyPropertyInScope, controller.create);
  router.patch('/:id', authorize('opex.update'), opexInScope, validateBody(UpdateOperatingExpenseSchema), bodyPropertyInScope, controller.update);
  router.delete('/:id', authorize('opex.delete'), opexInScope, controller.remove);

  return router;
}
