import { useQuery } from '@tanstack/react-query';
import { getOwners, type OwnersParams } from '@/lib/api/owners';
import type { OwnersResponse } from '@/types';

export function useOwners(params: OwnersParams) {
  return useQuery<OwnersResponse>({
    queryKey: ['reports', 'owners', params],
    queryFn: () => getOwners(params),
  });
}
