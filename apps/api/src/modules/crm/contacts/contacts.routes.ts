import { Router } from 'express';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactsRepository } from './contacts.repository';
// Assuming you have some DI container or export a db instance
import { db } from '../../../db'; 
// Assuming auth middleware exists
// import { requireAuth, requirePermissions } from '../../core/middleware';

export function createContactsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new ContactsRepository(dbInstance);
  const service = new ContactsService(repository);
  const controller = new ContactsController(service);

  // Apply auth and RBAC middlewares appropriately here
  // e.g. router.use(requireAuth);

  router.get('/', controller.getContacts);
  router.get('/:id', controller.getContactById);
  
  // router.post('/', requirePermissions('crm.contacts.create'), controller.createContact);
  router.post('/', controller.createContact);
  
  // router.put('/:id', requirePermissions('crm.contacts.update'), controller.updateContact);
  router.put('/:id', controller.updateContact);
  
  // router.delete('/:id', requirePermissions('crm.contacts.delete'), controller.deleteContact);
  router.delete('/:id', controller.deleteContact);

  return router;
}
