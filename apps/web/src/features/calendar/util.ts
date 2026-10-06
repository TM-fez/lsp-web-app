import type { CalendarBooking, CalendarClosure, ReservationStatus, UnitType } from '@/types';

/**
 * (Calendar, 2026-10-06) Pure date and layout arithmetic for the front-desk board. Dates are
 * 'YYYY-MM-DD' strings throughout and are shifted on a UTC date built from them — never
 * through the browser's own zone, which would move a night across midnight west of Gaborone.
 */

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole nights from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export interface DayColumn {
  iso: string;
  weekday: string; // MON
  day: string; // 05
  month: string; // OCT
  weekend: boolean;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function dayColumns(from: string, days: number): DayColumn[] {
  return Array.from({ length: days }, (_, i) => {
    const iso = addDays(from, i);
    const d = new Date(`${iso}T00:00:00Z`);
    const dow = d.getUTCDay();
    return {
      iso,
      weekday: WEEKDAYS[dow],
      day: iso.slice(8, 10),
      month: MONTHS[d.getUTCMonth()],
      weekend: dow === 0 || dow === 6,
    };
  });
}

/**
 * Where a stay sits on the board, in fractions of the visible width. Like Little Hotelier, a
 * bar runs from the middle of the arrival day to the middle of the departure morning, so a
 * same-day turnover shows as two bars meeting in one square rather than overlapping. A stay
 * that began before the window, or runs past it, is cut flat at the edge (`openStart` /
 * `openEnd`). Null when no night of it is on screen.
 */
export function barPlacement(
  start: string | null,
  end: string | null,
  from: string,
  days: number
): { left: number; width: number; openStart: boolean; openEnd: boolean } | null {
  const s = start == null ? -Infinity : daysBetween(from, start) + 0.5;
  const e = end == null ? Infinity : daysBetween(from, end) + 0.5;
  // No NIGHT on screen (left on the first morning, or arrives after the last night): nothing
  // to draw, even though half a square of the departure morning would technically fit.
  if (e <= 0.5 || s >= days) return null;
  const left = Math.max(0, s);
  const right = Math.min(days, e);
  if (right <= left) return null;
  return { left: left / days, width: (right - left) / days, openStart: s < 0, openEnd: e > days };
}

/** LH-style "Company, Guest" — the company first when there is one. */
export function bookingLabel(b: Pick<CalendarBooking, 'guest_name' | 'company_name' | 'status' | 'source'>): string {
  const guest = b.guest_name?.trim() || (b.status === 'BLOCKED' ? 'Booking.com' : 'Guest');
  return b.company_name ? `${b.company_name}, ${guest}` : guest;
}

export type BarTone = 'confirmed' | 'pending' | 'in' | 'out';

/** The legend's four booking colours. A Booking.com block is a confirmed stay to the desk. */
export function bookingTone(status: ReservationStatus): BarTone {
  if (status === 'CHECKED_IN') return 'in';
  if (status === 'CHECKED_OUT') return 'out';
  if (status === 'PENDING') return 'pending';
  return 'confirmed';
}

export const TONE_CLASS: Record<BarTone | 'closed' | 'hold', string> = {
  confirmed: 'bg-cal-confirmed text-white',
  pending: 'bg-cal-pending text-ink',
  in: 'bg-cal-in text-white',
  out: 'bg-cal-out text-white',
  closed: 'bg-cal-closed text-white',
  hold: 'bg-cal-hold text-ink',
};

export function closureTone(kind: CalendarClosure['kind']): 'closed' | 'hold' {
  return kind === 'HOLD' ? 'hold' : 'closed';
}

export const STATUS_WORDS: Record<BarTone, string> = {
  confirmed: 'Confirmed',
  pending: 'Provisional — not yet confirmed',
  in: 'Checked in',
  out: 'Checked out',
};

const TYPE_LABEL: Record<UnitType, string> = {
  STANDARD: 'Standard',
  DELUXE: 'Deluxe',
  SUITE: 'Suite',
  CONFERENCE: 'Conference',
  CUSTOM: 'Other units',
};
export const unitTypeLabel = (t: UnitType): string => TYPE_LABEL[t] ?? t;

/** The 7 / 14 / 28-night views LH offers. */
export const VIEW_DAYS = [7, 14, 28] as const;
