import { Router } from 'express';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';
import { LeadsRepository } from './leads.repository.js';
import { db } from '../../../config/db.js';
import { authenticate } from '../../../core/auth/authenticate.middleware.js';
import { authorize } from '../../../core/auth/authorize.middleware.js';
import { validateBody } from '../../../core/middleware/validate.middleware.js';
import { CreateLeadSchema, UpdateLeadSchema } from './leads.types.js';

export function createLeadsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new LeadsRepository(dbInstance);
  const service = new LeadsService(repository);
  const controller = new LeadsController(service);

  router.use(authenticate);

  router.get('/', authorize('crm.leads.read'), controller.getLeads);
  router.get('/:id', authorize('crm.leads.read'), controller.getLeadById);
  
  router.post('/', authorize('crm.leads.create'), validateBody(CreateLeadSchema), controller.createLead);

  router.patch('/:id', authorize('crm.leads.update'), validateBody(UpdateLeadSchema), controller.updateLead);
  
  router.delete('/:id', authorize('crm.leads.delete'), controller.deleteLead);

  return router;
}
