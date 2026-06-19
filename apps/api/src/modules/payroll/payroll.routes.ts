import { Router } from 'express';
import { PayrollController } from './payroll.controller.js';
import { PayrollService } from './payroll.service.js';
import { PayrollRepository } from './payroll.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { UpsertCompensationSchema, PostPayrollSchema } from './payroll.types.js';

export function createPayrollRouter(dbInstance = db): Router {
  const router = Router();
  const service = new PayrollService(new PayrollRepository(dbInstance));
  const controller = new PayrollController(service);

  router.use(authenticate);

  router.get('/employees', authorize('payroll.read'), controller.listEmployees);
  router.get('/summary', authorize('payroll.read'), controller.summary);
  router.put('/employees/:userId', authorize('payroll.manage'), validateBody(UpsertCompensationSchema), controller.upsert);
  router.post('/post-to-costs', authorize('payroll.manage'), validateBody(PostPayrollSchema), controller.postToOpex);

  return router;
}
