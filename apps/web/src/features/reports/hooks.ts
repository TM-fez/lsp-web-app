import { useQuery } from '@tanstack/react-query';
import { getPnl, type PnlParams } from '@/lib/api/reports';
import type { ReportsResponse } from '@/types';

export function usePnl(params: PnlParams) {
  return useQuery<ReportsResponse>({
    queryKey: ['reports', 'pnl', params],
    queryFn: () => getPnl(params),
  });
}
