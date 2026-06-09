import type { HousekeepingStatus } from '@/types';
import type { HousekeepingAction } from '@/lib/api/housekeeping';

export const HK_STATUSES: HousekeepingStatus[] = ['DIRTY', 'CLEANING', 'INSPECTED', 'READY'];

// The next turn action for a unit, derived from its housekeeping status.
// DIRTY -> start (clean) -> CLEANING -> inspect -> INSPECTED -> ready -> READY.
export const nextAction: Record<HousekeepingStatus, HousekeepingAction | null> = {
  DIRTY: 'start',
  CLEANING: 'inspect',
  INSPECTED: 'ready',
  READY: null,
};

export const actionLabel: Record<HousekeepingAction, string> = {
  start: 'Start cleaning',
  inspect: 'Mark inspected',
  ready: 'Mark ready',
};

export const turnResult: Record<HousekeepingAction, string> = {
  start: 'Cleaning started',
  inspect: 'Marked inspected',
  ready: 'Unit ready ✨',
};

export const hkLabel = (s: HousekeepingStatus) => s.charAt(0) + s.slice(1).toLowerCase();
