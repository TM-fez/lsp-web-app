import type { MaintenanceStatus, MaintenancePriority } from '@/types';

type Tone = 'slate' | 'green' | 'amber' | 'blue' | 'rose' | 'violet';

export const FILTER_STATUSES: MaintenanceStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
];

export const statusTone: Record<MaintenanceStatus, Tone> = {
  OPEN: 'amber',
  IN_PROGRESS: 'blue',
  BLOCKED: 'rose',
  COMPLETED: 'green',
  CANCELLED: 'slate',
};

export const statusLabel: Record<MaintenanceStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const PRIORITIES: MaintenancePriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const priorityTone: Record<MaintenancePriority, Tone> = {
  LOW: 'slate',
  MEDIUM: 'blue',
  HIGH: 'amber',
  CRITICAL: 'rose',
};

export const priorityLabel = (p: MaintenancePriority) => p.charAt(0) + p.slice(1).toLowerCase();

// The next lifecycle step a work order is waiting for, derived from its status, so the
// list only ever offers the one valid action: OPEN -> start -> IN_PROGRESS -> complete.
// (BLOCKED can also be completed; COMPLETED/CANCELLED are done.)
export type WorkOrderAction = 'start' | 'complete';

export const nextAction: Record<MaintenanceStatus, WorkOrderAction | null> = {
  OPEN: 'start',
  IN_PROGRESS: 'complete',
  BLOCKED: 'complete',
  COMPLETED: null,
  CANCELLED: null,
};

export const actionLabel: Record<WorkOrderAction, string> = {
  start: 'Start work',
  complete: 'Mark fixed',
};

/** Closed work orders are read-only (no more edits or lifecycle changes). */
export const isClosed = (s: MaintenanceStatus) => s === 'COMPLETED' || s === 'CANCELLED';

export function fmtDate(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
