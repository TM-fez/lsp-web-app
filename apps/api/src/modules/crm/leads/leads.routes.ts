import { Router } from 'express';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';
import { LeadsRepository } from './leads.repository.js';
import { ReservationsService } from '../../reservations/reservations.service.js';
import { ReservationsRepository } from '../../reservations/reservations.repository.js';
import { RoomsRepository } from '../../rooms/rooms.repository.js';
import { PricingService } from '../../pricing/pricing.service.js';
import { PricingRepository } from '../../pricing/pricing.repository.js';
import { db } from '../../../config/db.js';
import { authenticate } from '../../../core/auth/authenticate.middleware.js';
import { authorize } from '../../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../../core/scope/activeProperty.js';
import { validateBody } from '../../../core/middleware/validate.middleware.js';
import { CreateLeadSchema, UpdateLeadSchema, ConvertLeadSchema } from './leads.types.js';

export function createLeadsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new LeadsRepository(dbInstance);
  const reservations = new ReservationsService(
    new ReservationsRepository(dbInstance),
    new RoomsRepository(dbInstance),
    new PricingService(new PricingRepository(dbInstance)),
  );
  const service = new LeadsService(repository, reservations);
  const controller = new LeadsController(service);

  router.use(authenticate);

  router.get('/', authorize('crm.leads.read'), controller.getLeads);
  router.get('/:id', authorize('crm.leads.read'), controller.getLeadById);

  router.post('/', authorize('crm.leads.create'), validateBody(CreateLeadSchema), controller.createLead);

  router.patch('/:id', authorize('crm.leads.update'), validateBody(UpdateLeadSchema), controller.updateLead);

  // Convert-to-booking creates a reservation, so it needs reservations.create + an
  // active property (the chosen unit must belong to it).
  router.post(
    '/:id/convert',
    authorize('reservations.create'),
    requireActiveProperty,
    validateBody(ConvertLeadSchema),
    controller.convertLead,
  );

  router.delete('/:id', authorize('crm.leads.delete'), controller.deleteLead);

  return router;
}
