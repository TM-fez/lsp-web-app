import { env } from '../../config/env.js';

/**
 * Invoice due dates (migration 071).
 *
 * Rule: the LATER of the issue day and the check-in day, plus the payment terms.
 *
 * Why "later of" and not plain issue-date + terms: a guest is not late paying for a stay
 * that has not started, and pay-later clients settle after they arrive. Plain
 * issue + terms would put every booking made more than a week ahead into OVERDUE the
 * moment it was raised, which is noise on the one screen Accounts uses to decide who to
 * chase. All days are Africa/Gaborone calendar days (invariant 2) carried as
 * YYYY-MM-DD strings — never Dates, which shift a day with the server's timezone.
 */

/** Add whole days to a YYYY-MM-DD string. Pure calendar arithmetic, no timezone involved. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const out = new Date(Date.UTC(y!, m! - 1, d! + days));
  return out.toISOString().slice(0, 10);
}

export function computeDueDate(args: {
  /** Issue day, Africa/Gaborone (see todayInPropertyTZ). */
  issuedOn: string;
  /** The stay's check-in day, when the invoice belongs to a booking. */
  checkInDay?: string | null;
  termsDays?: number;
}): string {
  const terms = args.termsDays ?? env.INVOICE_TERMS_DAYS;
  const start = args.checkInDay && args.checkInDay > args.issuedOn ? args.checkInDay : args.issuedOn;
  return addDays(start, terms);
}
