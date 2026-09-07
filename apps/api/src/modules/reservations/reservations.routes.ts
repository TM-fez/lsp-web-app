import { Router } from 'express';
import { ReservationsController } from './reservations.controller.js';
import { ReservationsService } from './reservations.service.js';
import { ReservationsRepository } from './reservations.repository.js';
import { RoomsRepository } from '../rooms/rooms.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { QuotesRepository } from '../quotes/quotes.repository.js';
import { HoldsService } from '../holds/holds.service.js';
import { HoldsRepository } from '../holds/holds.repository.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PaymentsRepository } from '../payments/payments.repository.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { InvoicesRepository } from '../invoices/invoices.repository.js';
import { FilesRepository } from '../files/files.repository.js';
import { db } from '../../config/db.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { authorize } from '../../core/auth/authorize.middleware.js';
import { requireActiveProperty } from '../../core/scope/activeProperty.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { CreateReservationSchema, UpdateReservationSchema, ClaimOtaBookingSchema, MarkPaidSchema, ConfirmReservationSchema } from './reservations.types.js';

export function createReservationsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new ReservationsRepository(dbInstance);
  const rooms = new RoomsRepository(dbInstance);
  const pricing = new PricingService(new PricingRepository(dbInstance));
  // The money loop, wired the same way the quotes/holds/payments routers wire it —
  // POST /:id/mark-paid drives quote -> hold -> intent -> settlePaid for a booking
  // that already exists (see service.markPaid).
  const quotes = new QuotesService(new QuotesRepository(dbInstance), pricing);
  const holds = new HoldsService(new HoldsRepository(dbInstance), quotes);
  const payments = new PaymentsService(new PaymentsRepository(dbInstance), new HoldsRepository(dbInstance), quotes);
  // Invoices too: a recorded payment raises its own paid-up receipt, so the Finance
  // screens show who paid instead of staying empty (see service.markPaid).
  const invoices = new InvoicesService(
    new InvoicesRepository(dbInstance),
    quotes,
    new FilesRepository(dbInstance),
  );
  const service = new ReservationsService(repository, rooms, pricing, quotes, holds, payments, invoices);
  const controller = new ReservationsController(service);

  router.use(authenticate);
  // Every reservation route is scoped to the caller's active property.
  router.use(requireActiveProperty);

  router.get('/availability', authorize('reservations.read'), controller.checkAvailability);
  router.get('/', authorize('reservations.read'), controller.getReservations);
  router.get('/:id', authorize('reservations.read'), controller.getReservationById);
  // Amount-due breakdown: prices the stay + applies the (approved) discount.
  router.get('/:id/pricing', authorize('reservations.read'), controller.getPricing);
  // The money axis (migration 067): total / paid / outstanding, derived from invoices.
  // Gated on reservations.read, not a payments permission — this REPORTS money, it
  // never moves any, and anyone who can see a booking can see what it owes.
  router.get('/:id/folio', authorize('reservations.read'), controller.getFolio);

  router.post('/', authorize('reservations.create'), validateBody(CreateReservationSchema), controller.createReservation);

  router.patch('/:id', authorize('reservations.update'), validateBody(UpdateReservationSchema), controller.modifyReservation);

  // Claim an imported Booking.com block: attach a real guest contact and promote it
  // to CONFIRMED (Tier 1 of the OTA contact-info plan; see service.claimOtaBooking).
  router.post('/:id/claim', authorize('reservations.update'), validateBody(ClaimOtaBookingSchema), controller.claimOtaBooking);

  // Record an off-system payment (cash/EFT/mobile money at the desk) against a
  // PENDING booking so it reaches CONFIRMED — the missing path for public-site
  // bookings, which arrive with no hold behind them. Deliberately gated on the SAME
  // permissions the equivalent cockpit flow needs end-to-end (payments.create to
  // raise the intent, payments.update to settle it), so this changes WHERE staff can
  // take a payment, never WHO may take one.
  router.post('/:id/mark-paid', authorize('payments.create', 'payments.update'), validateBody(MarkPaidSchema), controller.markPaid);

  // Confirm a stay with NO money in hand (owner decision 2026-09-07, invariant 3).
  // Some clients settle after the stay, and a booking nobody has paid for is still a
  // booking the house must honour. Gated on reservations.update, deliberately NOT a new
  // permission and NOT a payments one: reception already holds payments.create +
  // payments.update (064) and could already reach CONFIRMED by recording a P1 payment,
  // so a new gate would be theatre. The audit trail is the control — the row records
  // confirmed_without_payment plus who and why.
  router.post('/:id/confirm', authorize('reservations.update'), validateBody(ConfirmReservationSchema), controller.confirmReservation);

  // Record that a confirmed guest never arrived (migration 065). Gated on
  // reservations.update, not a payment permission: this changes what the booking says
  // happened, it does not move money. No body — the id and the clock say everything.
  router.post('/:id/no-show', authorize('reservations.update'), controller.markNoShow);
  
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
