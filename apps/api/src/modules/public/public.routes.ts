import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { PublicRepository } from './public.repository.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { ReservationsRepository } from '../reservations/reservations.repository.js';
import { RoomsRepository } from '../rooms/rooms.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PricingRepository } from '../pricing/pricing.repository.js';
import { ContactsRepository } from '../crm/contacts/contacts.repository.js';
import { db } from '../../config/db.js';

/**
 * PUBLIC, NO-AUTH booking routes — the guest-facing front door onto the existing
 * booking engine. Deliberately narrow: read bookable layouts, and submit one
 * booking request (which becomes a PENDING reservation). A tight per-IP limit
 * sits on the write path on top of the global limiter.
 */
export function createPublicRouter(dbInstance = db): Router {
  const router = Router();

  const rooms = new RoomsRepository(dbInstance);
  const pricing = new PricingService(new PricingRepository(dbInstance));
  const reservations = new ReservationsService(new ReservationsRepository(dbInstance), rooms, pricing);
  const contacts = new ContactsRepository(dbInstance);
  const service = new PublicService(new PublicRepository(dbInstance), reservations, contacts);
  const controller = new PublicController(service);

  const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 8, // a handful of booking attempts per IP per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: { statusCode: 429, error: 'Too Many Requests', message: 'Too many booking attempts. Please try again later.' },
  });

  const lookupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30, // generous for a guest re-checking their booking; hostile scanning is not
    standardHeaders: true,
    legacyHeaders: false,
    message: { statusCode: 429, error: 'Too Many Requests', message: 'Too many lookups. Please try again later.' },
  });

  router.get('/stay', controller.getStayInfo);
  router.post('/bookings', bookingLimiter, controller.createBooking);
  // Manage-my-booking: code + email must both match (never enumerable by code alone).
  router.get('/bookings/lookup', lookupLimiter, controller.lookupBooking);

  // In-apartment QR self check-in (Phase 5): read the unit's stay context, then the
  // guest submits their own contact details (per-IP limited; token is unguessable).
  router.get('/checkin', lookupLimiter, controller.getCheckinInfo);
  router.post('/checkin', bookingLimiter, controller.submitCheckin);

  return router;
}
