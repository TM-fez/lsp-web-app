// G30 — splitting a stay total across the nights that earned it.
//
// Pure arithmetic, no database: this is the part of the accrual ledger most likely
// to be quietly wrong, and it is testable without one.
//
// All money is INTEGER minor units (thebe; 100 = 1 BWP) — invariant 1. Nothing here
// may produce a fraction, and the slices must sum back to the stay total EXACTLY,
// because the P&L adds them up and the owner reconciles the answer against a folio.

import { splitInclusive } from '../quotes/quotes.util.js';

export interface NightlySlice {
  /** The night earned, 'YYYY-MM-DD'. Half-open: check-out earns nothing. */
  stay_date: string;
  /** Gross (VAT-inclusive) thebe earned that night. */
  amount: number;
  /** The tax inside `amount`. Net revenue for the night is amount - tax_amount. */
  tax_amount: number;
}

/**
 * The nights of a stay, half-open `[check_in, check_out)` — invariant 4.
 *
 * The check-out date is excluded, which is the same rule the `reservations_no_overlap`
 * constraint uses and the reason same-day checkout/checkin is legal: the departing
 * guest and the arriving one cannot both earn that date, because only the arriving
 * one does.
 *
 * Dates are walked in UTC on purpose. A stay date is a CALENDAR date with no time of
 * day — it is stored as a `date` column, and a calendar night has no timezone
 * ambiguity to resolve (which is why the accrual ledger is immune to D08, the bug
 * that buckets cash-basis months in the wrong zone). Walking in local time would
 * invent an offset that the data does not have.
 */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  let cursor = Date.parse(`${checkIn}T00:00:00Z`);
  if (Number.isNaN(cursor) || Number.isNaN(end)) return nights;

  while (cursor < end) {
    nights.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return nights;
}

/**
 * Shift a 'YYYY-MM-DD' date by whole days, staying a calendar date throughout.
 *
 * Walked in UTC for the same reason as nightsOf: a stay date has no time of day, so
 * introducing the process's local zone would only invent an offset the data does not
 * have — and, near midnight, an off-by-one.
 */
export function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Spread `total` over `count` nights in whole thebe, giving the indivisible
 * remainder to the EARLIEST nights.
 *
 * Earliest rather than latest is arbitrary but FIXED. On a stay that straddles month
 * end the choice decides which month gets the spare thebe, so changing it later would
 * restate a month the owner has already read — for no gain whatsoever.
 */
function spread(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Split a stay's agreed total into one slice per night.
 *
 * The gross and the tax are spread INDEPENDENTLY, each with the same earliest-first
 * remainder rule, rather than deriving each night's tax from its own gross. That is
 * what makes both columns sum back exactly: a per-night `splitInclusive` would round
 * N times and land a thebe or two away from the stay's own VAT figure, which is the
 * number that goes on a BURS return.
 *
 * `tax_amount <= amount` holds for every slice by construction, which the table's
 * `revenue_recognition_amounts_sane` check also enforces. Writing total = qN + a and
 * tax = qN + b with the same quotient forces b <= a (otherwise tax > total), so a
 * night can never take a remainder unit of tax without also taking one of gross; and
 * when tax's quotient is strictly smaller there is a whole unit of headroom.
 *
 * Returns [] for a stay with no nights — a same-day booking earns nothing, and the
 * half-open rule says so rather than the caller having to.
 */
export function splitStayAcrossNights(
  checkIn: string,
  checkOut: string,
  total: number,
  taxRateBps: number
): NightlySlice[] {
  const nights = nightsOf(checkIn, checkOut);
  if (nights.length === 0) return [];

  const { tax } = splitInclusive(total, taxRateBps);
  const grossPerNight = spread(total, nights.length);
  const taxPerNight = spread(tax, nights.length);

  return nights.map((stay_date, i) => ({
    stay_date,
    amount: grossPerNight[i]!,
    tax_amount: taxPerNight[i]!,
  }));
}
