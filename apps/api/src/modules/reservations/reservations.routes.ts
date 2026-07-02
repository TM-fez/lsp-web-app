import { Router } from 'express';
import { ReservationsController } from './reservations.controller.js';
import { ReservationsService } from './reservations.service.js';
import { ReservationsRepository } from './reservations.repository.js';
import { RoomsRepository } from '../rooms/rooms.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateReservationSchema, UpdateReservationSchema, ClaimOtaBookingSchema } from './reservations.types.js';

export function createReservationsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new ReservationsRepository(dbInstance);
  const rooms = new RoomsRepository(dbInstance);
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const service = new ReservationsService(repository, rooms, pricing);
  const controller = new ReservationsController(service);

  router.use(authenticate);
  // Every reservation route is scoped to the caller's active property.
  router.use(requireActiveProperty);

  router.get('/availability', authorize('reservations.read'), controller.checkAvailability);
  router.get('/', authorize('reservations.read'), controller.getReservations);
  router.get('/:id', authorize('reservations.read'), controller.getReservationById);
  // Amount-due breakdown: prices the stay + applies the (approved) discount.
  router.get('/:id/pricing', authorize('reservations.read'), controller.getPricing);

  router.post('/', authorize('reservations.create'), validateBody(CreateReservationSchema), controller.createReservation);

  router.patch('/:id', authorize('reservations.update'), validateBody(UpdateReservationSchema), controller.modifyReservation);

  // Claim an imported Booking.com block: attach a real guest contact and promote it
  // to CONFIRMED (Tier 1 of the OTA contact-info plan; see service.claimOtaBooking).
  router.post('/:id/claim', authorize('reservations.update'), validateBody(ClaimOtaBookingSchema), controller.claimOtaBooking);
  
  // Specific endpoint for cancellation could be POST /:id/cancel or DELETE /:id
  router.delete('/:id', authorize('reservations.delete'), controller.cancelReservation);
  // Permanently remove a cancelled booking from the lists (soft-delete; CANCELLED only).
  router.delete('/:id/remove', authorize('reservations.delete'), controller.removeReservation);

  // Build 2b — per-booking discount: request (operations) → approve (Tameem/admin).
  router.post('/:id/discount', authorize('reservations.discount.request'), controller.setDiscount);
  router.post('/:id/discount/approve', authorize('reservations.discount.approve'), controller.approveDiscount);
  router.delete('/:id/discount', authorize('reservations.discount.request'), controller.removeDiscount);

  return router;
}
