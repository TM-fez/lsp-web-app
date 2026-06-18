import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listInvoices, issueInvoice, settleInvoice, refundInvoice, type InvoiceListParams } from '@/lib/api/invoices';
import { listQuotes } from '@/lib/api/quotes';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { Invoice, Paginated, Quote } from '@/types';

const KEY = ['invoices'] as const;

export function useInvoices(params: InvoiceListParams) {
  return useQuery<Paginated<Invoice>>({
    queryKey: [...KEY, params],
    queryFn: () => listInvoices(params),
  });
}

/** Active quotes available to invoice against (for the "raise invoice" picker). */
export function useActiveQuotes(enabled: boolean) {
  return useQuery<Quote[]>({
    queryKey: ['quotes', 'active'],
    queryFn: async () => (await listQuotes({ status: 'ACTIVE', limit: 100 })).data,
    enabled,
  });
}

export function useIssueInvoice() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ quote_id, kind }: { quote_id: string; kind: 'DEPOSIT' | 'BALANCE' }) =>
      issueInvoice(quote_id, kind),
    onSuccess: () => {
      toast.success('Invoice raised ✓');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
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
