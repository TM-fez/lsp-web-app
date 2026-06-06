import type { HousekeepingStatus, RoomStatus, ReservationStatus, HousekeepingTaskStatus } from '@/types';

export type Tone = 'slate' | 'green' | 'amber' | 'blue' | 'rose' | 'violet';

export const housekeepingTone: Record<HousekeepingStatus, Tone> = {
  READY: 'green',
  DIRTY: 'rose',
  CLEANING: 'amber',
  INSPECTED: 'blue',
};

export const roomStatusTone: Record<RoomStatus, Tone> = {
  AVAILABLE: 'green',
  OCCUPIED: 'blue',
  MAINTENANCE: 'amber',
  OUT_OF_SERVICE: 'slate',
};

export const reservationTone: Record<ReservationStatus, Tone> = {
  PENDING: 'amber',
  CONFIRMED: 'green',
  CHECKED_IN: 'blue',
  CHECKED_OUT: 'slate',
  CANCELLED: 'rose',
};

export const taskActionLabel: Record<HousekeepingTaskStatus, string | null> = {
  OPEN: 'Start cleaning',
  CLEANING: 'Mark inspected',
  INSPECTED: 'Mark ready',
  DONE: null,
};

/** A unit can take a guest only when operationally free and housekeeping-ready. */
export function isAssignable(status: RoomStatus, housekeeping: HousekeepingStatus): boolean {
  return status === 'AVAILABLE' && housekeeping === 'READY';
}

/** Money is integer minor units (thebe; 100 = 1 BWP). */
export function formatMoney(minor: number, currency = 'BWP'): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
