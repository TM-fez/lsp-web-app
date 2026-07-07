import { api } from './client';
import type { FinanceCockpit } from '@/types';

export interface ReceivablesParams {
  property_id?: string;
}

/** P4.2 — real-time outstanding ledger (receivables + ageing + refunds payable). */
export async function getReceivables(params: ReceivablesParams = {}): Promise<FinanceCockpit> {
  const { data } = await api.get<FinanceCockpit>('/finance/receivables', { params });
  return data;
}
