import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listExpenses, approveExpense, reconcileExpense } from '@/lib/api/expenses';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { Expense, ExpenseStatus } from '@/types';

const KEY = ['expenses'] as const;

export function useExpenses(status?: ExpenseStatus) {
  return useQuery<Expense[]>({
    queryKey: [...KEY, status ?? 'ALL'],
    queryFn: () => listExpenses(status),
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useApproveExpense() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => approveExpense(id),
    onSuccess: () => {
      toast.success('Spend approved ✓');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useReconcileExpense() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => reconcileExpense(id),
    onSuccess: () => {
      toast.success('Reconciled ✓');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
