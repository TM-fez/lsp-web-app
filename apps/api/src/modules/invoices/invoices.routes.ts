import { Router } from 'express';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { InvoicesRepository } from './invoices.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { QuotesRepository } from '../quotes/quotes.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { FilesRepository } from '../files/files.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { IssueInvoiceSchema, SettleInvoiceSchema, RefundInvoiceSchema } from './invoices.types.js';

export function createInvoicesRouter(dbInstance = db): Router {
  const router = Router();
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const quotes = new QuotesService(new QuotesRepository(dbInstance), pricing);
  const filesRepo = new FilesRepository(dbInstance);
  const service = new InvoicesService(new InvoicesRepository(dbInstance), quotes, filesRepo);
  const controller = new InvoicesController(service);

  router.use(authenticate);

  router.get('/', authorize('invoices.read'), controller.list);
  router.get('/:id', authorize('invoices.read'), controller.get);
  router.post('/', authorize('invoices.create'), validateBody(IssueInvoiceSchema), controller.issue);
  router.post('/:id/settle', authorize('invoices.update'), validateBody(SettleInvoiceSchema), controller.settle);
  router.post('/:id/refund', authorize('invoices.refund'), validateBody(RefundInvoiceSchema), controller.refund);

  return router;
}
