import { api } from './client';
import type { FinanceCockpit } from '@/types';

// The server scopes to the active property (X-Property-Id) — there is no property filter.
export type ReceivablesParams = Record<string, never>;

/** P4.2 — real-time outstanding ledger (receivables + ageing + refunds payable). */
export async function getReceivables(params: ReceivablesParams = {}): Promise<FinanceCockpit> {
  const { data } = await api.get<FinanceCockpit>('/finance/receivables', { params });
  return data;
}

/** One cancelled / no-show booking that still holds the guest's money (all amounts in thebe). */
export interface HeldOnCancelledRow {
  reservation_id: string;
  guest_name: string | null;
  room_code: string | null;
  status: 'CANCELLED' | 'NO_SHOW';
  check_in_date: string;
  check_out_date: string;
  currency: string;
  received: number;
  cancelled_on: string;
}

export interface HeldOnCancelled {
  as_of: string;
  total_held: number;
  count: number;
  rows: HeldOnCancelledRow[];
  note: string;
}

/** Cancelled bookings that still hold paid money — surfaced so nothing is retained silently. */
export async function getHeldOnCancelled(): Promise<HeldOnCancelled> {
  const { data } = await api.get<HeldOnCancelled>('/finance/cancelled-with-money');
  return data;
}
