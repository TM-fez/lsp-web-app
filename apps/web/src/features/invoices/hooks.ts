import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listInvoices, settleInvoice, refundInvoice, type InvoiceListParams } from '@/lib/api/invoices';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { Invoice, Paginated } from '@/types';

const KEY = ['invoices'] as const;

export function useInvoices(params: InvoiceListParams) {
  return useQuery<Paginated<Invoice>>({
    queryKey: [...KEY, params],
    queryFn: () => listInvoices(params),
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useSettleInvoice() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => settleInvoice(id),
    onSuccess: () => {
      toast.success('Invoice marked paid ✓');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useRefundInvoice() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, amount, reason }: { id: string; amount: number; reason: string }) =>
      refundInvoice(id, amount, reason),
    onSuccess: () => {
      toast.success('Refund recorded ✓');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
