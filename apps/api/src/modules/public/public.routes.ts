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

  router.get('/stay', controller.getStayInfo);
  router.post('/bookings', bookingLimiter, controller.createBooking);

  return router;
}
