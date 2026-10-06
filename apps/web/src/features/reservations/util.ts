import type { ReservationStatus, ReservationSource, PaymentState } from '@/types';
import { pulaAmountError, pulaToThebe } from '@/lib/utils/money';

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
  REFUNDED: 'slate',
};

export const paymentLabel: Record<PaymentState, string> = {
  UNPAID: 'unpaid',
  PART_PAID: 'part paid',
  PAID: 'paid',
  REFUNDED: 'fully refunded',
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

/**
 * Discounts: the server only accepts one on a PENDING booking ("before payment confirms
 * it"); anything later is a 409. Say so up front instead of offering a form that can only
 * fail. null = a discount can be applied.
 */
export function discountBlockedReason(status: ReservationStatus): string | null {
  if (status === 'PENDING') return null;
  if (status === 'CONFIRMED') {
    return 'A discount can only be added while the booking is pending, before payment confirms it. This booking is already confirmed, so its price is fixed.';
  }
  return `A discount can only be added while a booking is pending. This booking is ${statusLabel(status).toLowerCase()}.`;
}

/**
 * The value typed in the discount box, as the API wants it: a whole percent (1–100), or a
 * Pula amount turned into thebe. `error` is plain English for the line under the box.
 */
export function parseDiscountInput(
  type: 'PERCENT' | 'FIXED',
  text: string,
): { value: number; error: null } | { value: null; error: string | null } {
  const t = text.trim();
  if (t === '') return { value: null, error: null };
  if (type === 'PERCENT') {
    if (!/^\d+$/.test(t)) return { value: null, error: 'Enter a whole percentage from 1 to 100.' };
    const n = Number(t);
    if (n < 1 || n > 100) return { value: null, error: 'A percentage discount must be between 1 and 100.' };
    return { value: n, error: null };
  }
  const message = pulaAmountError(t);
  if (message) return { value: null, error: message };
  const thebe = pulaToThebe(t);
  if (!(thebe > 0)) return { value: null, error: 'Enter an amount above P0.00.' };
  return { value: thebe, error: null };
}
