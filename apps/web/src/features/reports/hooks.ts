import { useQuery } from '@tanstack/react-query';
import { getPnl, getNudges, type PnlParams, type Nudge } from '@/lib/api/reports';
import type { ReportsResponse } from '@/types';

export function usePnl(params: PnlParams) {
  return useQuery<ReportsResponse>({
    queryKey: ['reports', 'pnl', params],
    queryFn: () => getPnl(params),
  });
}

export function useNudges() {
  return useQuery<Nudge[]>({ queryKey: ['reports', 'nudges'], queryFn: getNudges });
}
