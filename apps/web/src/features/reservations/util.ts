import type { ReservationStatus, ReservationSource } from '@/types';

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
};

export const statusLabel = (s: ReservationStatus) => s.replace(/_/g, ' ').toLowerCase();

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

/** A reservation can be edited / cancelled only while it is still open. */
export const isOpen = (s: ReservationStatus) => s === 'PENDING' || s === 'CONFIRMED';

export function fmtDate(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
