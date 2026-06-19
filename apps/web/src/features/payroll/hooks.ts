import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listEmployees, getPayrollSummary, upsertCompensation, postPayrollToCosts,
  type CompensationInput,
} from '@/lib/api/payroll';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { EmployeePay, PayrollSummary } from '@/types';

const KEY = ['payroll'] as const;

export function useEmployees() {
  return useQuery<EmployeePay[]>({ queryKey: [...KEY, 'employees'], queryFn: listEmployees });
}

export function usePayrollSummary() {
  return useQuery<PayrollSummary>({ queryKey: [...KEY, 'summary'], queryFn: getPayrollSummary });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useUpsertCompensation() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: CompensationInput }) => upsertCompensation(userId, input),
    onSuccess: () => { toast.success('Saved ✓'); refresh(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function usePostPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (month?: string) => postPayrollToCosts(month),
    onSuccess: (r) => {
      toast.success(`Posted P${(r.amount / 100).toLocaleString('en')} to operating costs ✓`);
      qc.invalidateQueries({ queryKey: ['operating-expenses'] });
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
