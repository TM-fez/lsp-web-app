import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth';
import { formatMoney, thebeToPula, pulaToThebe } from '@/lib/utils/money';
import { cn } from '@/lib/utils/cn';
import { useInvoices, useSettleInvoice, useRefundInvoice } from './hooks';
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

  const [filter, setFilter] = useState<InvoiceStatus | 'ALL'>('ALL');
  const { data, isLoading, isError, refetch } = useInvoices({
    status: filter === 'ALL' ? undefined : filter,
    limit: 100,
  });
  const settle = useSettleInvoice();
  const refund = useRefundInvoice();
  const busy = settle.isPending || refund.isPending;

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
        {data && <div className="text-right">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Showing</div>
          <div className="font-display text-3xl tabnum text-ink">{data.total}</div>
        </div>}
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
          title="No invoices"
          description="Invoices are raised against a quote when a deposit or balance is due, then settled here once paid."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-paper">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3.5 font-medium">Invoice</th>
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
                  <td className="px-4 py-3.5"><Badge tone={kindTone[inv.kind]}>{inv.kind}</Badge></td>
                  <td className="px-4 py-3.5 text-right tabnum text-ink">{formatMoney(inv.total_amount, inv.currency)}</td>
                  <td className="px-4 py-3.5"><Badge tone={statusTone[inv.status]}>{inv.status}</Badge></td>
                  <td className="px-4 py-3.5 text-muted">{fmtDate(inv.created_at)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end gap-2">
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
    </div>
  );
}
