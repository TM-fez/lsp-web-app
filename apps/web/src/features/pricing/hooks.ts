import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listRatePlans,
  createRatePlan,
  updateRatePlan,
  deleteRatePlan,
  type RatePlanInput,
} from '@/lib/api/pricing';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { RatePlan } from '@/types';

const PLANS_KEY = ['rate-plans'] as const;

export function useRatePlans() {
  return useQuery<RatePlan[]>({ queryKey: PLANS_KEY, queryFn: () => listRatePlans() });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: PLANS_KEY });
}

export function useCreateRatePlan() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: RatePlanInput) => createRatePlan(input),
    onSuccess: () => {
      toast.success('Rate plan created');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateRatePlan() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<RatePlanInput> }) => updateRatePlan(id, input),
    onSuccess: () => {
      toast.success('Rate plan updated');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useDeleteRatePlan() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteRatePlan(id),
    onSuccess: () => {
      toast.success('Rate plan removed');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
