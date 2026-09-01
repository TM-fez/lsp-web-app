import { useQuery } from '@tanstack/react-query';
import { listPayments, getPayment, type PaymentListParams } from '@/lib/api/payments';

const PAYMENTS_KEY = ['payments'] as const;

export function usePayments(params: PaymentListParams = {}) {
  return useQuery({
    queryKey: [...PAYMENTS_KEY, params],
    queryFn: () => listPayments(params),
  });
}

/** One intent with its full attempt log. Only fetched while the drawer is open. */
export function usePayment(id: string | null) {
  return useQuery({
    queryKey: [...PAYMENTS_KEY, 'detail', id],
    queryFn: () => getPayment(id!),
    enabled: !!id,
  });
}
