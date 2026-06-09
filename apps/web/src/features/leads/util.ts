import type { LeadStatus, LeadSource } from '@/types';
import type { SettableLeadStatus } from '@/lib/api/leads';

type Tone = 'slate' | 'green' | 'amber' | 'blue' | 'rose' | 'violet';

// CONVERTED is excluded — it's system-set by a future convert-to-booking flow.
export const USER_LEAD_STATUSES: SettableLeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'LOST'];

export const LEAD_SOURCES: LeadSource[] = [
  'WHATSAPP',
  'WALK_IN',
  'BOOKING_COM',
  'WEBSITE',
  'REFERRAL',
  'CORPORATE',
  'OTHER',
];

export const statusTone: Record<LeadStatus, Tone> = {
  NEW: 'blue',
  CONTACTED: 'amber',
  QUALIFIED: 'violet',
  CONVERTED: 'green',
  LOST: 'rose',
};

export const statusLabel = (s: LeadStatus) => s.charAt(0) + s.slice(1).toLowerCase();

export const sourceLabel: Record<LeadSource, string> = {
  WHATSAPP: 'WhatsApp',
  WALK_IN: 'Walk-in',
  BOOKING_COM: 'Booking.com',
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  CORPORATE: 'Corporate',
  OTHER: 'Other',
};

export const sourceText = (s: LeadSource | null) => (s ? sourceLabel[s] : '—');

export function fmtDate(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
