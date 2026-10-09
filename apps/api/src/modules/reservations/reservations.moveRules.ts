import { AppError } from '../../core/errors/AppError.js';

/**
 * (Round 11, N11-1) ONE rule for changing a stay's unit or dates, whichever screen asks.
 *
 * The calendar drag (2026-10-06) had these rules in its preview; the booking drawer and the
 * PATCH API did not, so an edit could quietly do what a drag refused: shift a checked-in
 * guest's arrival day (after which the unit looked free tonight and a second booking was
 * accepted on top of an in-house guest), start a stay in the past, or re-date a cancelled
 * booking. Both paths now ask this function, and the edit asks it again under the booking's
 * row lock so a check-in that lands mid-edit is judged by the row as it really is.
 *
 * Owner decision 2026-10-09: once a guest has checked in, only an ADMIN may change the
 * arrival day (a correction — the guest really arrived another day). Everyone else is refused
 * here, on the server, not just hidden on screen. Overlap rules still apply to admins: this
 * function only decides whether the change may be ATTEMPTED; availability is checked after.
 */
export interface StayChange {
  status: string;
  /** The stay as it is now (YYYY-MM-DD). */
  fromCheckIn: string;
  /** The stay as asked for (YYYY-MM-DD). */
  checkIn: string;
  checkOut: string;
  /** Gaborone day (todayInPropertyTZ). */
  today: string;
  isAdmin: boolean;
}

export type StayChangeProblem = { kind: 'status' | 'arrived' | 'past' | 'order'; message: string };

const MOVABLE = ['PENDING', 'CONFIRMED', 'CHECKED_IN'];

export function stayChangeProblem(c: StayChange): StayChangeProblem | null {
  if (!MOVABLE.includes(c.status)) {
    return {
      kind: 'status',
      message:
        c.status === 'BLOCKED'
          ? 'This is a Booking.com booking — change it on Booking.com.'
          : 'Only pending, confirmed and in-house stays can be moved.',
    };
  }
  const arrivalChanges = c.checkIn !== c.fromCheckIn;
  if (c.status === 'CHECKED_IN' && arrivalChanges && !c.isAdmin) {
    return {
      kind: 'arrived',
      message:
        'This guest has already arrived, so the arrival day can’t change — only the unit or the leaving day. An admin can correct it if it was recorded wrongly.',
    };
  }
  if (c.checkIn >= c.checkOut) return { kind: 'order', message: 'The stay must be at least one night.' };
  if (c.status === 'CHECKED_IN') {
    // An admin's correction of an in-house arrival is by nature a day already lived — but
    // never a day still to come, which would free tonight under a guest who is in the unit.
    if (arrivalChanges && c.checkIn > c.today) {
      return { kind: 'order', message: 'A guest who is already here can’t arrive on a later day than today.' };
    }
    return null;
  }
  // Only a NEW arrival day is judged: an in-house guest who arrived yesterday keeps that day.
  if (arrivalChanges && c.checkIn < c.today) {
    return { kind: 'past', message: 'A stay can’t be moved to start in the past.' };
  }
  return null;
}

/** The same verdict as an error, for the edit. A refused arrival is a permission question (403). */
export function assertStayChangeAllowed(c: StayChange): void {
  const p = stayChangeProblem(c);
  if (!p) return;
  if (p.kind === 'arrived') throw AppError.forbidden(p.message);
  if (p.kind === 'status') throw AppError.conflict(p.message);
  throw AppError.badRequest(p.message);
}

/**
 * (Round 12, N12-2) The one rule for a status set by hand — the cancel route and a PATCH that
 * carries `status`. Everything else that moves a status has its own guarded path: payment and
 * confirm-without-payment confirm, check-in/out, no-show, channel sync. So by hand a booking may
 * only be cancelled, and only while nobody has arrived (PENDING / CONFIRMED). Sending the status
 * it already has is not a change. Same 409 wording as the cancel route always used.
 */
export function assertStatusChange(from: string, to: string): void {
  if (from === to) return;
  if (to === 'CANCELLED' && (from === 'PENDING' || from === 'CONFIRMED')) return;
  if (to === 'CANCELLED') throw AppError.conflict(`Cannot cancel reservation with status ${from}`);
  throw AppError.conflict(
    `A booking can’t be moved from ${from.toLowerCase().replace('_', ' ')} to ${to.toLowerCase().replace('_', ' ')} by editing it.`
  );
}

