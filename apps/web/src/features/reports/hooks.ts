import { useQuery } from '@tanstack/react-query';
import { getPnl, getRevenue, getNudges, type PnlParams, type RevenueParams, type Nudge } from '@/lib/api/reports';
import type { ReportsResponse, RevenueReconciliation } from '@/types';

export function usePnl(params: PnlParams) {
  return useQuery<ReportsResponse>({
    queryKey: ['reports', 'pnl', params],
    queryFn: () => getPnl(params),
  });
}

export function useRevenue(params: RevenueParams) {
  return useQuery<RevenueReconciliation>({
    queryKey: ['reports', 'revenue', params],
    queryFn: () => getRevenue(params),
  });
}

export function useNudges() {
  return useQuery<Nudge[]>({ queryKey: ['reports', 'nudges'], queryFn: getNudges });
}
