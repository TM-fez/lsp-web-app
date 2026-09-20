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
import { requireActiveProperty } from '../../core/scope/activeProperty.js';
import {
  requireInActivePropertyAllowUnattributed,
  requireBodyRefInActiveProperty,
  propertyOfInvoice,
  propertyOfHold,
} from '../../core/scope/propertyOf.js';
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

  // H5 property scoping (see propertyOf.ts) with the Unattributed exception so open
  // house-wide invoices stay settleable — same coalesce rule as the list filter.
  const inProperty = requireInActivePropertyAllowUnattributed(
    dbInstance,
    propertyOfInvoice,
    'Invoice'
  );
  const holdRefInProperty = requireBodyRefInActiveProperty(dbInstance, 'hold_id', propertyOfHold, 'Hold');

  router.get('/', authorize('invoices.read'), requireActiveProperty, controller.list);
  router.get('/:id/document', authorize('invoices.read'), requireActiveProperty, inProperty, controller.document);
  router.post('/:id/send', authorize('invoices.update'), requireActiveProperty, inProperty, controller.send);
  router.get('/:id', authorize('invoices.read'), requireActiveProperty, inProperty, controller.get);
  router.post('/', authorize('invoices.create'), validateBody(IssueInvoiceSchema), requireActiveProperty, holdRefInProperty, controller.issue);
  router.post('/:id/settle', authorize('invoices.update'), requireActiveProperty, inProperty, validateBody(SettleInvoiceSchema), controller.settle);
  router.post('/:id/refund', authorize('invoices.refund'), requireActiveProperty, inProperty, validateBody(RefundInvoiceSchema), controller.refund);

  return router;
}
