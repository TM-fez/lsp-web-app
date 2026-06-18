import { api } from './client';
import type { ReportsResponse } from '@/types';

export interface PnlParams {
  from?: string;        // YYYY-MM-DD
  to?: string;          // YYYY-MM-DD
  property_id?: string;
}

export async function getPnl(params: PnlParams): Promise<ReportsResponse> {
  const { data } = await api.get<ReportsResponse>('/reports/pnl', { params });
  return data;
}
