import { Router } from 'express';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { ContactsRepository } from './contacts.repository.js';
import { db } from '../../../config/db.js';
import { authenticate } from '../../../core/auth/authenticate.middleware.js';
import { authorize } from '../../../core/auth/authorize.middleware.js';
import { validateBody } from '../../../core/middleware/validate.middleware.js';
import { CreateContactSchema, UpdateContactSchema } from '../crm.types.js';

export function createContactsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new ContactsRepository(dbInstance);
  const service = new ContactsService(repository);
  const controller = new ContactsController(service);

  router.use(authenticate);

  router.get('/', authorize('crm.contacts.read'), controller.getContacts);
  router.get('/:id', authorize('crm.contacts.read'), controller.getContactById);
  
  router.post('/', authorize('crm.contacts.create'), validateBody(CreateContactSchema), controller.createContact);

  router.patch('/:id', authorize('crm.contacts.update'), validateBody(UpdateContactSchema), controller.updateContact);
  
  router.delete('/:id', authorize('crm.contacts.delete'), controller.deleteContact);

  return router;
}
