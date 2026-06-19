import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listOperatingExpenses, createOperatingExpense, updateOperatingExpense, deleteOperatingExpense,
  listRecurring, createRecurring, updateRecurring, deleteRecurring, generateRecurring,
  type OpexListParams, type OpexInput, type RecurringInput,
} from '@/lib/api/operatingExpenses';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { OperatingExpense, RecurringCost } from '@/types';

const KEY = ['operating-expenses'] as const;
const RKEY = ['recurring-costs'] as const;

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

// ── Recurring templates ─────────────────────────────────────────────────────
export function useRecurring() {
  return useQuery<RecurringCost[]>({ queryKey: RKEY, queryFn: listRecurring });
}
function useRefreshRecurring() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: RKEY });
}
export function useCreateRecurring() {
  const refresh = useRefreshRecurring();
  return useMutation({
    mutationFn: (input: RecurringInput) => createRecurring(input),
    onSuccess: () => { toast.success('Recurring cost added ✓'); refresh(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}
export function useUpdateRecurring() {
  const refresh = useRefreshRecurring();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<RecurringInput> }) => updateRecurring(id, input),
    onSuccess: () => { toast.success('Recurring cost updated ✓'); refresh(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}
export function useDeleteRecurring() {
  const refresh = useRefreshRecurring();
  return useMutation({
    mutationFn: (id: string) => deleteRecurring(id),
    onSuccess: () => { toast.success('Recurring cost removed ✓'); refresh(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}
export function useGenerateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (month?: string) => generateRecurring(month),
    onSuccess: (r) => {
      toast.success(r.created > 0 ? `Generated ${r.created} cost${r.created === 1 ? '' : 's'} ✓` : 'Already up to date for this month');
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
