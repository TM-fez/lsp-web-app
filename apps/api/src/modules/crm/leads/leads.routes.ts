import { Router } from 'express';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadsRepository } from './leads.repository';
import { db } from '../../../db'; 
import { authenticate } from '../../../core/auth/authenticate.middleware.js';
import { authorize } from '../../../core/auth/authorize.middleware.js';

export function createLeadsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new LeadsRepository(dbInstance);
  const service = new LeadsService(repository);
  const controller = new LeadsController(service);

  router.use(authenticate);

  router.get('/', authorize('crm.leads.read'), controller.getLeads);
  router.get('/:id', authorize('crm.leads.read'), controller.getLeadById);
  
  router.post('/', authorize('crm.leads.create'), controller.createLead);
  
  router.patch('/:id', authorize('crm.leads.update'), controller.updateLead);
  
  router.delete('/:id', authorize('crm.leads.delete'), controller.deleteLead);

  return router;
}
