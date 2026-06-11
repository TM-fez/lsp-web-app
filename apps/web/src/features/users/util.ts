import type { RoleName } from '@/types';

type Tone = 'slate' | 'green' | 'amber' | 'blue' | 'rose' | 'violet';

export const ROLE_OPTIONS: RoleName[] = [
  'admin',
  'operations',
  'reception',
  'accounts',
  'maintenance',
  'housekeeping',
];

export const roleTone: Record<RoleName, Tone> = {
  admin: 'violet',
  operations: 'blue',
  reception: 'green',
  accounts: 'amber',
  maintenance: 'rose',
  housekeeping: 'slate',
};

export const roleLabel: Record<RoleName, string> = {
  admin: 'Admin',
  operations: 'Operations',
  reception: 'Reception',
  accounts: 'Accounts',
  maintenance: 'Maintenance',
  housekeeping: 'Housekeeping',
};

/** One-line plain-English description shown under the role dropdown. */
export const roleHint: Record<RoleName, string> = {
  admin: 'Full access to everything, including staff logins.',
  operations: 'Runs the day-to-day: cockpit, bookings, guests, cleaning, repairs.',
  reception: 'Front desk: bookings, guests, check-in and check-out.',
  accounts: 'Money only: payments, invoices and reports.',
  maintenance: 'Repairs and work orders.',
  housekeeping: 'The cleaning board and unit turns.',
};

/**
 * The lead rank only changes what a HOUSEKEEPING user can do (approving cleans
 * via housekeeping.inspect); supervisory roles already carry that power.
 */
export const LEAD_INSPECT_PERM = 'housekeeping.inspect';

/** Roles whose own permissions already include front-desk work — no second hat needed. */
const COVERS_RECEPTION_ALREADY: RoleName[] = ['admin', 'operations', 'reception'];

export function canTakeReceptionHat(role: RoleName): boolean {
  return !COVERS_RECEPTION_ALREADY.includes(role);
}

/** Does this user's extra grant set amount to "also covers reception"? */
export function hasReceptionHat(extraPermissions: string[], receptionPerms: string[]): boolean {
  if (receptionPerms.length === 0) return false;
  return receptionPerms.every((p) => extraPermissions.includes(p));
}

/**
 * Build the extra_permissions set the drawer saves: the reception pack when the
 * second hat is on, plus the inspect grant for housekeeping leads.
 */
export function buildExtraPermissions(opts: {
  role: RoleName;
  isLead: boolean;
  coversReception: boolean;
  receptionPerms: string[];
}): string[] {
  const extras = new Set<string>();
  if (opts.coversReception && canTakeReceptionHat(opts.role)) {
    for (const p of opts.receptionPerms) extras.add(p);
  }
  if (opts.isLead && opts.role === 'housekeeping') extras.add(LEAD_INSPECT_PERM);
  return [...extras];
}

/** Client-side mirror of the API password policy, for instant feedback. */
export function passwordIssue(pw: string): string | null {
  if (pw.length < 8) return 'At least 8 characters';
  if (!/[A-Z]/.test(pw)) return 'Add an uppercase letter';
  if (!/[a-z]/.test(pw)) return 'Add a lowercase letter';
  if (!/[0-9]/.test(pw)) return 'Add a number';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Add a symbol (e.g. ! or @)';
  return null;
}

export function fmtDate(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
