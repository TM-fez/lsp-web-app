import { Router, type Request } from 'express';
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
import { LeadsRepository } from '../crm/leads/leads.repository.js';
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
  const leads = new LeadsRepository(dbInstance);
  const service = new PublicService(new PublicRepository(dbInstance), reservations, contacts, leads);
  const controller = new PublicController(service);

  // Per-IP limits. req.ip comes from X-Forwarded-For (`trust proxy`, app.ts), and whether a
  // caller who goes straight to the Render address can forge it was never verified on live
  // (ROADMAP H1 follow-up). So each per-IP limit below is backed by one keyed on something a
  // caller can't forge (audit 2026-10-11, needs-checking #1): the email, the QR token, or —
  // for creating bookings — the whole site.
  const limiter = (windowMs: number, max: number, message: string, keyGenerator?: (req: Request) => string) =>
    rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      ...(keyGenerator ? { keyGenerator } : {}),
      message: { statusCode: 429, error: 'Too Many Requests', message },
    });
  const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const BOOKINGS = 'Too many booking attempts. Please try again later.';
  const LOOKUPS = 'Too many lookups. Please try again later.';
  const BUSY = 'We’re receiving a lot of online bookings right now. Please try again in a little while, or send us an enquiry.';

  const bookingLimiter = limiter(15 * 60 * 1000, 8, BOOKINGS); // a handful per IP per 15 min
  const lookupLimiter = limiter(15 * 60 * 1000, 30, LOOKUPS); // generous for a guest, not for scanning

  // A guest re-checking their own booking makes a few lookups; guessing the 6-character code
  // for someone's email takes millions. Counted per email, a forged IP doesn't help.
  const lookupPerEmail = limiter(60 * 60 * 1000, 20, LOOKUPS, (req) => `lookup:${lower(req.query.email)}`);
  // One email can't be sent a stream of confirmation emails, whoever is typing it in.
  const bookingPerEmail = limiter(60 * 60 * 1000, 5, BOOKINGS, (req) => `book:${lower(req.body?.email)}`);
  const enquiryPerEmail = limiter(60 * 60 * 1000, 5, BOOKINGS, (req) => `enq:${lower(req.body?.email) || 'none'}`);
  // An unpaid website booking holds a real unit (invariant 7). Fresh emails beat the per-email
  // limit, so the site as a whole takes at most this many online bookings an hour — far above
  // a real day here, and it caps how much of the estate a script could take off sale.
  // 👤 Owner may tune it.
  const bookingSiteWide = limiter(60 * 60 * 1000, 20, BUSY, () => 'public-bookings');
  // The QR token is the unit itself: a stranger hammering one sticker is counted per sticker.
  const checkinPerToken = limiter(15 * 60 * 1000, 20, LOOKUPS, (req) => `qr:${lower(req.query.token ?? req.body?.token)}`);

  router.get('/stay', controller.getStayInfo);
  router.post('/bookings', bookingLimiter, bookingPerEmail, bookingSiteWide, controller.createBooking);
  // Manage-my-booking: code + email must both match (never enumerable by code alone).
  router.get('/bookings/lookup', lookupLimiter, lookupPerEmail, controller.lookupBooking);

  // In-apartment QR self check-in (Phase 5): read the unit's stay context, then the
  // guest submits their own contact details (per-IP limited; token is unguessable).
  router.get('/checkin', lookupLimiter, checkinPerToken, controller.getCheckinInfo);
  router.post('/checkin', bookingLimiter, checkinPerToken, controller.submitCheckin);

  // Public enquiry form → auto-filed lead (rate-limited like bookings).
  router.get('/enquiries/properties', controller.getEnquiryProperties);
  router.post('/enquiries', bookingLimiter, enquiryPerEmail, controller.createEnquiry);

  return router;
}
