import { api } from './client';
import type { FinanceCockpit } from '@/types';

// The server scopes to the active property (X-Property-Id) — there is no property filter.
export type ReceivablesParams = Record<string, never>;

/** P4.2 — real-time outstanding ledger (receivables + ageing + refunds payable). */
export async function getReceivables(params: ReceivablesParams = {}): Promise<FinanceCockpit> {
  const { data } = await api.get<FinanceCockpit>('/finance/receivables', { params });
  return data;
}
