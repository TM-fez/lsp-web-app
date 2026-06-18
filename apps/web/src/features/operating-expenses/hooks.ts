import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listOperatingExpenses, createOperatingExpense, updateOperatingExpense, deleteOperatingExpense,
  type OpexListParams, type OpexInput,
} from '@/lib/api/operatingExpenses';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { OperatingExpense } from '@/types';

const KEY = ['operating-expenses'] as const;

export function useOperatingExpenses(params: OpexListParams) {
  return useQuery<OperatingExpense[]>({
    queryKey: [...KEY, params],
    queryFn: () => listOperatingExpenses(params),
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useCreateOperatingExpense() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: OpexInput) => createOperatingExpense(input),
    onSuccess: () => { toast.success('Cost added ✓'); refresh(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateOperatingExpense() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<OpexInput> }) => updateOperatingExpense(id, input),
    onSuccess: () => { toast.success('Cost updated ✓'); refresh(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useDeleteOperatingExpense() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => deleteOperatingExpense(id),
    onSuccess: () => { toast.success('Cost removed ✓'); refresh(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}
