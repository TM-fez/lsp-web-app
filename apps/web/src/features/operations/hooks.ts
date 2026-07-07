import { useQuery } from '@tanstack/react-query';
import { getOperations, type OperationsParams } from '@/lib/api/operations';
import type { OperationsResponse } from '@/types';

export function useOperations(params: OperationsParams = {}) {
  return useQuery<OperationsResponse>({
    queryKey: ['operations', params],
    queryFn: () => getOperations(params),
  });
}
