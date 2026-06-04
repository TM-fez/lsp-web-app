import { Router } from 'express';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactsRepository } from './contacts.repository';
// Assuming you have some DI container or export a db instance
import { db } from '../../../db'; 
import { authenticate } from '../../../core/auth/authenticate.middleware.js';
import { authorize } from '../../../core/auth/authorize.middleware.js';

export function createContactsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new ContactsRepository(dbInstance);
  const service = new ContactsService(repository);
  const controller = new ContactsController(service);

  router.use(authenticate);

  router.get('/', authorize('crm.contacts.read'), controller.getContacts);
  router.get('/:id', authorize('crm.contacts.read'), controller.getContactById);
  
  router.post('/', authorize('crm.contacts.create'), controller.createContact);
  
  router.patch('/:id', authorize('crm.contacts.update'), controller.updateContact);
  
  router.delete('/:id', authorize('crm.contacts.delete'), controller.deleteContact);

  return router;
}
