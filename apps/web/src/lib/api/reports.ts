import { api } from './client';
import type { ReportsResponse, RevenueReconciliation } from '@/types';

export interface PnlParams {
  from?: string;        // YYYY-MM-DD
  to?: string;          // YYYY-MM-DD
  property_id?: string;
}

export async function getPnl(params: PnlParams): Promise<ReportsResponse> {
  const { data } = await api.get<ReportsResponse>('/reports/pnl', { params });
  return data;
}

export interface RevenueParams {
  from?: string;        // YYYY-MM-DD
  to?: string;          // YYYY-MM-DD
  property_id?: string;
}

/**
 * G30 — earned vs received, month by month. Always accrual on the earned side, so
 * unlike `/reports/pnl` this endpoint takes no `basis`: the whole point of the view
 * is to hold the two clocks side by side, and a basis switch would collapse it.
 */
export async function getRevenue(params: RevenueParams): Promise<RevenueReconciliation> {
  const { data } = await api.get<RevenueReconciliation>('/reports/revenue', { params });
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
