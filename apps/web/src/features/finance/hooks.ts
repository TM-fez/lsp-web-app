import { useQuery } from '@tanstack/react-query';
import { getReceivables, type ReceivablesParams } from '@/lib/api/finance';
import type { FinanceCockpit } from '@/types';

export function useReceivables(params: ReceivablesParams = {}) {
  return useQuery<FinanceCockpit>({
    queryKey: ['finance', 'receivables', params],
    queryFn: () => getReceivables(params),
  });
}
