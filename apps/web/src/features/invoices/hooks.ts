import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listInvoices, issueInvoice, settleInvoice, refundInvoice, getInvoiceDocument, sendInvoice, type InvoiceListParams } from '@/lib/api/invoices';
import { listQuotes } from '@/lib/api/quotes';
import { errMessage, fullRefundMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { InvoiceDocument, InvoiceList, Quote } from '@/types';

const KEY = ['invoices'] as const;

export function useInvoiceDocument(id: string) {
  return useQuery<InvoiceDocument>({
    queryKey: [...KEY, 'document', id],
    queryFn: () => getInvoiceDocument(id),
  });
}

export function useSendInvoice() {
  return useMutation({
    mutationFn: (id: string) => sendInvoice(id),
    onSuccess: (r) => toast.success(`Sent to ${r.to} ✓`),
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useInvoices(params: InvoiceListParams) {
  return useQuery<InvoiceList>({
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
  const qc = useQueryClient();
  // (R9 #2) A refund also changes the booking it belongs to (its money panel, which may be
  // open right now) and the finance lists — refresh those too, not only the invoices.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ['reservations'] });
    qc.invalidateQueries({ queryKey: ['finance'] });
  };
  return useMutation({
    mutationFn: ({
      id,
      amount,
      reason,
      idempotencyKey,
      confirmFullRefund,
    }: {
      id: string;
      amount: number;
      reason: string;
      idempotencyKey?: string;
      confirmFullRefund?: boolean;
    }) => refundInvoice(id, amount, reason, idempotencyKey, confirmFullRefund),
    onSuccess: () => {
      toast.success('Refund recorded ✓');
      refresh();
    },
    onError: (e) => {
      // (R10 #6) A refused refund usually means the money moved under us (another refund, a
      // changed stay) — re-read it, or the screen keeps offering the figure that was refused.
      refresh();
      // The "makes the stay free" question is asked by the screen itself, not as a toast.
      if (!fullRefundMessage(e)) toast.error(errMessage(e));
    },
  });
}
