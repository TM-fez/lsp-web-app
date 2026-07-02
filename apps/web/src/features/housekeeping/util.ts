import type { HousekeepingStatus } from '@/types';
import type { HousekeepingAction } from '@/lib/api/housekeeping';

export const HK_STATUSES: HousekeepingStatus[] = ['DIRTY', 'CLEANING', 'INSPECTED', 'READY'];

// The next turn action for a unit, derived from its housekeeping status.
// Three-stage flow: DIRTY -> start (Routine Checks) -> CLEANING -> inspect
// (Supervisor validation) -> INSPECTED -> ready (PM sign-off) -> READY.
export const nextAction: Record<HousekeepingStatus, HousekeepingAction | null> = {
  DIRTY: 'start',
  CLEANING: 'inspect',
  INSPECTED: 'ready',
  READY: null,
};

export const actionLabel: Record<HousekeepingAction, string> = {
  start: 'Start cleaning',
  inspect: 'Mark inspected',
  ready: 'Sign off',
};

export const turnResult: Record<HousekeepingAction, string> = {
  start: 'Cleaning started',
  inspect: 'Marked inspected',
  ready: 'Signed off — unit ready ✨',
};

// Per-stage permission gate, mirroring the API routes: cleaners start, leads/
// supervisors inspect, managers sign off.
export function canDoAction(action: HousekeepingAction, hasPerm: (p: string) => boolean): boolean {
  if (action === 'start') return hasPerm('housekeeping.update');
  if (action === 'inspect') return hasPerm('housekeeping.update') && hasPerm('housekeeping.inspect');
  return hasPerm('housekeeping.signoff');
}

export const hkLabel = (s: HousekeepingStatus) => s.charAt(0) + s.slice(1).toLowerCase();

/** Render minutes as a compact duration, e.g. 95 → "1h 35m", 45 → "45m". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}
