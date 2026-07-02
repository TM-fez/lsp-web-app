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

export interface Nudge {
  property_id: string;
  property_name: string;
  tone: 'opportunity' | 'info';
  title: string;
  detail: string;
}

/** H6 — rule-based occupancy nudges (forward 7/30-day demand). */
export async function getNudges(): Promise<Nudge[]> {
  const { data } = await api.get<{ data: Nudge[] }>('/reports/nudges');
  return data.data;
}
