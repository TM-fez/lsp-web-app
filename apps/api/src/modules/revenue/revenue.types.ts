// G30 — the accrual revenue ledger.
//
// All money is INTEGER minor units (thebe; 100 = 1 BWP) — invariant 1.

/**
 * The statuses whose nights EARN revenue.
 *
 * A deliberate asymmetry with invariant 7, and the point where the money axis and
 * the lifecycle axis part company (invariant 3). PENDING *holds the room* and counts
 * as forward demand (D01, D02) — but it has not earned anything. Nobody has agreed
 * to pay for it, and an abandoned public booking is auto-cancelled within the day, so
 * recognising it would book revenue that routinely evaporates.
 *
 * CANCELLED and NO_SHOW earn nothing: a stay that did not happen is not revenue,
 * whatever was invoiced for it (a cancellation fee is its own invoice, not a night).
 *
 * BLOCKED is a Booking.com night imported over iCal. LSP knows the dates and nothing
 * about the money — the OTA holds that. It earns here only once `claimOtaBooking()`
 * turns it into a real booking with a real guest and a real total.
 */
export const EARNING_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] as const;

export type EarningStatus = (typeof EARNING_STATUSES)[number];

/** Why a booking's recognised nights were replaced. Audit prose, not an enum the UI reads. */
export type SupersedeReason =
  | 'RE_PRICED'
  | 'DATES_CHANGED'
  | 'ROOM_CHANGED'
  | 'NO_LONGER_EARNING'
  | 'BACKFILL_CORRECTION';

/** One booking as the recogniser sees it: the dates, the unit and the agreed money. */
export interface RecognisableReservation {
  id: string;
  room_id: string;
  check_in_date: string;  // YYYY-MM-DD
  check_out_date: string; // YYYY-MM-DD
  status: string;
  /** The frozen agreed total, or null when nothing was ever frozen (see total_source). */
  folio_total_amount: number | null;
  folio_currency: string;
  /** Resolved from the booking's own paperwork — see RevenueRepository.findRecognisable. */
  tax_rate_bps: number;
}

/**
 * One live row of the ledger.
 *
 * `stay_date` is a 'YYYY-MM-DD' STRING, formatted by Postgres rather than parsed by
 * the driver. That is not a preference. node-postgres turns a `date` column into a JS
 * Date at midnight in the NODE PROCESS's local zone — `process.env.TZ`, not the
 * database session's timezone, which has no effect on it. Run the API with
 * TZ=Africa/Gaborone (UTC+2, the timezone of record) and `'2035-02-01'::date` comes
 * back as 2035-01-31T22:00Z, whose ISO date is the PREVIOUS day. Every comparison
 * would then report a change, the sweep would restate the whole ledger every night,
 * and it would restate it onto the wrong dates.
 *
 * Today's containers happen to run TZ=UTC, which hides this completely — so it is a
 * deployment setting away from being a silent, permanent off-by-one in the P&L. A
 * calendar night has no timezone (which is why the accrual ledger is immune to D08 by
 * construction); keeping it a string is what preserves that.
 */
export interface LiveNight {
  id: string;
  reservation_id: string;
  room_id: string;
  stay_date: string;
  currency: string;
  amount: number;
  tax_amount: number;
  tax_rate_bps: number;
  total_source: 'FOLIO' | 'PRICED';
  version: number;
}

export interface RecogniseResult {
  reservations_examined: number;
  reservations_changed: number;
  nights_written: number;
  nights_superseded: number;
  /** Bookings whose total had to be reconstructed at today's rates (total_source PRICED). */
  reconstructed: number;
}

export interface RevenueRequestMeta {
  userId: string | null;
  ip?: string | null;
  requestId?: string | null;
}
