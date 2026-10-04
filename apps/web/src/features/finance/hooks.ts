import { useQuery } from '@tanstack/react-query';
import { getHeldOnCancelled, getReceivables, type HeldOnCancelled, type ReceivablesParams } from '@/lib/api/finance';
import type { FinanceCockpit } from '@/types';

export function useReceivables(params: ReceivablesParams = {}) {
  return useQuery<FinanceCockpit>({
    queryKey: ['finance', 'receivables', params],
    queryFn: () => getReceivables(params),
  });
}

export function useHeldOnCancelled() {
  return useQuery<HeldOnCancelled>({
    queryKey: ['finance', 'cancelled-with-money'],
    queryFn: getHeldOnCancelled,
  });
}
