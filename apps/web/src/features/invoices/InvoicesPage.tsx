import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth';
import { formatMoney, thebeToPula, pulaToThebe } from '@/lib/utils/money';
import { cn } from '@/lib/utils/cn';
import { useInvoices, useSettleInvoice, useRefundInvoice, useActiveQuotes, useIssueInvoice } from './hooks';
import type { Invoice, InvoiceStatus } from '@/types';

const FILTERS: { key: InvoiceStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'ISSUED', label: 'Unpaid' },
  { key: 'PAID', label: 'Paid' },
  { key: 'REFUNDED', label: 'Refunded' },
  { key: 'VOID', label: 'Void' },
];

const kindTone = { DEPOSIT: 'blue', BALANCE: 'slate', REFUND: 'amber' } as const;
const statusTone = { ISSUED: 'amber', PARTIALLY_PAID: 'blue', PAID: 'green', REFUNDED: 'slate', VOID: 'slate' } as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function InvoicesPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canSettle = hasPerm('invoices.update');
  const canRefund = hasPerm('invoices.refund');
  const canIssue = hasPerm('invoices.create');

  const [filter, setFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
  const { data, isLoading, isError, refetch } = useInvoices({
    status: filter === 'ALL' ? undefined : filter,
    limit: 100,
  });
  const settle = useSettleInvoice();
  const refund = useRefundInvoice();
  const issue = useIssueInvoice();
  const busy = settle.isPending || refund.isPending || issue.isPending;

  // Issue (raise) dialog state
  const [issuing, setIssuing] = useState(false);
  const [quoteId, setQuoteId] = useState('');
  const [kind, setKind] = useState<'DEPOSIT' | 'BALANCE'>('DEPOSIT');
  const quotes = useActiveQuotes(issuing);

  const submitIssue = () => {
    if (!quoteId) return;
    issue.mutate({ quote_id: quoteId, kind }, { onSuccess: () => { setIssuing(false); setQuoteId(''); } });
  };

  // Refund dialog state
  const [refunding, setRefunding] = useState<Invoice | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const openRefund = (inv: Invoice) => {
    setRefunding(inv);
    setAmount(thebeToPula(inv.total_amount));
    setReason('');
  };

  const submitRefund = () => {
    if (!refunding) return;
    const thebe = pulaToThebe(amount);
    if (Number.isNaN(thebe) || thebe <= 0 || thebe > refunding.total_amount || !reason.trim()) return;
    refund.mutate(
      { id: refunding.id, amount: thebe, reason: reason.trim() },
      { onSuccess: () => setRefunding(null) },
    );
  };

  const invoices = data?.data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Finance · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Invoices</h1>
          <p className="mt-2 text-sm text-muted">Deposits, balances and refunds across bookings.</p>
        </div>
        <div className="flex items-end gap-4">
          {data && <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Showing</div>
            <div className="font-display text-3xl tabnum text-ink">{data.total}</div>
          </div>}
          {canIssue && (
            <Button variant="primary" onClick={() => setIssuing(true)}><Plus className="mr-1.5 h-4 w-4" />New invoice</Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-xs transition-[background-color,color,border-color] duration-300',
              filter === f.key ? 'border-forest bg-forest text-cream' : 'border-line bg-paper text-char hover:border-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load invoices"
          description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No invoices yet"
          description="Recording a payment on a booking raises a paid receipt here automatically. You can also raise one by hand against a quote when a deposit or balance is due, then settle it here once the guest pays."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-paper">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3.5 font-medium">Invoice</th>
                <th className="px-4 py-3.5 font-medium">Bill to</th>
                <th className="px-4 py-3.5 font-medium">Stay</th>
                <th className="px-4 py-3.5 font-medium">Type</th>
                <th className="px-4 py-3.5 text-right font-medium">Amount</th>
                <th className="px-4 py-3.5 font-medium">Status</th>
                <th className="px-4 py-3.5 font-medium">Issued</th>
                <th className="px-4 py-3.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-line transition-colors duration-300 last:border-0 hover:bg-cream-2">
                  <td className="px-4 py-3.5">
                    <div className="font-display text-base text-ink">{inv.number}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    {inv.bill_to_name ? (
                      <>
                        <div className="text-ink">{inv.bill_to_name}</div>
                        {/* Only worth a second line when the bill goes somewhere other
                            than the guest — a company paying for its staff member. */}
                        {inv.guest_name && inv.guest_name !== inv.bill_to_name && (
                          <div className="text-xs text-muted">for {inv.guest_name}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {inv.unit_code ? (
                      <>
                        <div className="text-ink">{inv.unit_code}</div>
                        {inv.check_in_date && inv.check_out_date && (
                          <div className="text-xs text-muted">
                            {fmtDate(inv.check_in_date)} → {fmtDate(inv.check_out_date)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5"><Badge tone={kindTone[inv.kind]}>{inv.kind}</Badge></td>
                  <td className="px-4 py-3.5 text-right tabnum text-ink">{formatMoney(inv.total_amount, inv.currency)}</td>
                  <td className="px-4 py-3.5"><Badge tone={statusTone[inv.status]}>{inv.status}</Badge></td>
                  <td className="px-4 py-3.5 text-muted">{fmtDate(inv.created_at)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => window.open(`/invoices/${inv.id}/print`, '_blank')}>
                        <FileText className="mr-1 h-3.5 w-3.5" />View
                      </Button>
                      {(inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') && canSettle && (
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => settle.mutate(inv.id)}>
                          Mark paid
                        </Button>
                      )}
                      {inv.status === 'PAID' && inv.kind !== 'REFUND' && canRefund && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => openRefund(inv)}>
                          Refund
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!refunding} onOpenChange={(o) => !o && setRefunding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund {refunding?.number}</DialogTitle>
            <DialogDescription>
              Records a refund invoice against this payment. Max {refunding ? formatMoney(refunding.total_amount, refunding.currency) : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="refund-amount">Amount (Pula)</Label>
              <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="refund-reason">Reason</Label>
              <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. guest cancelled within policy" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRefunding(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={busy || !reason.trim() || Number.isNaN(pulaToThebe(amount)) || pulaToThebe(amount) <= 0 || (refunding ? pulaToThebe(amount) > refunding.total_amount : true)}
                onClick={submitRefund}
              >
                Record refund
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={issuing} onOpenChange={(o) => !o && setIssuing(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise an invoice</DialogTitle>
            <DialogDescription>Pick an active quote and which part of it to bill.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="iss-quote">Quote</Label>
              <Select id="iss-quote" value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                <option value="">Select a quote…</option>
                {(quotes.data ?? []).map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.unit_type.charAt(0) + q.unit_type.slice(1).toLowerCase()} · {q.nights} nights · {formatMoney(q.total_amount, q.currency)} (deposit {formatMoney(q.deposit_amount, q.currency)})
                  </option>
                ))}
              </Select>
              {quotes.isLoading && <span className="text-xs text-muted">Loading quotes…</span>}
              {quotes.isError && <span className="text-xs text-terra">Couldn’t load quotes (need quotes.read).</span>}
              {!quotes.isLoading && !quotes.isError && (quotes.data?.length ?? 0) === 0 && (
                <span className="text-xs text-muted">No active quotes to invoice.</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="iss-kind">Bill</Label>
              <Select id="iss-kind" value={kind} onChange={(e) => setKind(e.target.value as 'DEPOSIT' | 'BALANCE')}>
                <option value="DEPOSIT">Deposit</option>
                <option value="BALANCE">Balance</option>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIssuing(false)}>Cancel</Button>
              <Button variant="primary" disabled={busy || !quoteId} onClick={submitIssue}>Raise invoice</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
