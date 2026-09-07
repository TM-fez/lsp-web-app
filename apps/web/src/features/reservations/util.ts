import type { ReservationStatus, ReservationSource, PaymentState } from '@/types';

type Tone = 'slate' | 'green' | 'amber' | 'blue' | 'rose' | 'violet';

/** Whole nights between two date strings (check-out exclusive). */
export function nights(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export const statusTone: Record<ReservationStatus, Tone> = {
  PENDING: 'amber',
  CONFIRMED: 'green',
  CHECKED_IN: 'blue',
  CHECKED_OUT: 'slate',
  CANCELLED: 'rose',
  BLOCKED: 'violet',
  NO_SHOW: 'rose',
};

// "blocked" alone reads like a maintenance state — name the OTA origin instead.
// "no show" reads as two words rather than a status, so hyphenate it.
export const statusLabel = (s: ReservationStatus) =>
  s === 'BLOCKED' ? 'OTA block' : s === 'NO_SHOW' ? 'no-show' : s.replace(/_/g, ' ').toLowerCase();

/**
 * The MONEY badge, deliberately separate from statusTone above.
 *
 * Since 2026-09-07 a booking can be CONFIRMED, or the guest already in the unit, with
 * nothing paid — so one badge can no longer carry both facts. Green here means the
 * money is in, and nothing else does.
 */
export const paymentTone: Record<PaymentState, Tone> = {
  UNPAID: 'rose',
  PART_PAID: 'amber',
  PAID: 'green',
};

export const paymentLabel: Record<PaymentState, string> = {
  UNPAID: 'unpaid',
  PART_PAID: 'part paid',
  PAID: 'paid',
};

// Booking origin, ordered for the filter dropdown (most common first).
export const SOURCES: ReservationSource[] = [
  'WALK_IN',
  'PHONE',
  'EMAIL',
  'WEBSITE',
  'BOOKING_COM',
  'CORPORATE',
  'DIRECT',
  'OTHER',
];

const SOURCE_LABELS: Record<ReservationSource, string> = {
  WALK_IN: 'Walk-in',
  PHONE: 'Phone',
  EMAIL: 'Email',
  WEBSITE: 'Website',
  BOOKING_COM: 'Booking.com',
  CORPORATE: 'Corporate',
  DIRECT: 'Direct',
  OTHER: 'Other',
};

export const sourceLabel = (s: ReservationSource) => SOURCE_LABELS[s] ?? s;

/**
 * A reservation can be edited / cancelled only while it is still open. Note this is
 * about the STAY, not the money: a confirmed booking nobody has paid for is still open.
 */
export const isOpen = (s: ReservationStatus) => s === 'PENDING' || s === 'CONFIRMED';

export function fmtDate(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
