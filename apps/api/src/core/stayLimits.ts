import { todayInPropertyTZ } from './time.js';

/**
 * (Audit 2026-10-11, H-1) How long a stay may be, and how far ahead the public page may book.
 *
 * The price engine walks a stay night by night (PricingService.priceStay), so its cost grows
 * with the stay. Nothing bounded a stay's length, and the public /stay form takes any date:
 * one anonymous booking leaving in the year 275000 (~99 million nights) ran the API out of
 * memory and took everyone down — staff, guests and the Booking.com feed. The booking row is
 * written before it is priced, so it was still there after a restart.
 *
 * - MAX_STAY_NIGHTS is the engine's own ceiling, checked inside priceStay so no caller —
 *   staff booking, quote, date edit, preview, calendar — can ask it for more. Three years is
 *   far beyond any real stay here (a "lease" is anything from 28 nights) and still trivial to
 *   price.
 * - The public page is tighter: a stranger can hold at most a year, starting at most
 *   18 months out. Longer or further-ahead stays go through an enquiry, where a person
 *   decides. 👤 Owner may tune both numbers.
 */
export const MAX_STAY_NIGHTS = 1096;
export const MAX_PUBLIC_STAY_NIGHTS = 366;
export const MAX_PUBLIC_LEAD_DAYS = 548;

const DAY_MS = 86_400_000;

/** Whole nights between two dates (check-out exclusive), by calendar day in UTC. */
export function stayNights(checkIn: Date, checkOut: Date): number {
  const from = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  const to = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());
  return Math.round((to - from) / DAY_MS);
}

/** True when a stay is within the engine's ceiling (any caller). */
export function withinStayLimit(checkIn: Date, checkOut: Date): boolean {
  return stayNights(checkIn, checkOut) <= MAX_STAY_NIGHTS;
}

/** True when check-in is no more than MAX_PUBLIC_LEAD_DAYS after today in Gaborone. */
export function withinPublicLead(checkIn: Date, now: Date = new Date()): boolean {
  const today = new Date(`${todayInPropertyTZ(now)}T00:00:00Z`);
  return stayNights(today, checkIn) <= MAX_PUBLIC_LEAD_DAYS;
}

export const STAY_TOO_LONG_MESSAGE =
  'That stay is too long to book in one go — the most is three years. Split it into shorter stays.';
