import { useState } from 'react';
import { CreditCard, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { formatMoney } from '@/lib/utils/money';
import { cn } from '@/lib/utils/cn';
import { usePayments, usePayment } from './hooks';
import type { PaymentIntent, PaymentStatus, PaymentMethod } from '@/types';

/**
 * Payments — the record of money attempted, not money invoiced.
 *
 * Every intent is currently created and settled inside one operator action, so a
 * failure is seen by the person who caused it and nowhere else. A real gateway (DPO)
 * makes that asynchronous: the guest's card is declined minutes later, on a server
 * callback, with nobody watching. `last_error` and the attempt log have been recorded
 * from the beginning and had no screen to appear on — this is that screen, built
 * before the gateway rather than after the first lost booking.
 */

// "Needs attention" leads: it is the only tab anyone has to act on, and a screen whose
// default view is a wall of successful payments buries the one that failed.
const FILTERS: { key: PaymentStatus | 'ATTENTION' | 'ALL'; label: string }[] = [
  { key: 'ATTENTION', label: 'Needs attention' },
  { key: 'ALL', label: 'All' },
  { key: 'PAID', label: 'Paid' },
  { key: 'PENDING', label: 'Awaiting' },
  { key: 'FAILED', label: 'Failed' },
];

const statusTone = {
  PENDING: 'amber', RETRY: 'amber', PAID: 'green', FAILED: 'rose', EXPIRED: 'slate',
} as const;

const statusLabel: Record<PaymentStatus, string> = {
  PENDING: 'Awaiting', RETRY: 'Retrying', PAID: 'Paid', FAILED: 'Failed', EXPIRED: 'Expired',
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  EFT: 'Bank transfer',
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Card',
  CORPORATE_CREDIT: 'Company account',
};

/** Still owed the operator's attention: failed outright, or mid-retry. */
const needsAttention = (p: PaymentIntent) => p.status === 'FAILED' || p.status === 'RETRY';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function PaymentsPage() {
  const [filter, setFilter] = useState<PaymentStatus | 'ATTENTION' | 'ALL'>('ATTENTION');
  const [openId, setOpenId] = useState<string | null>(null);

  // ATTENTION spans two statuses, so it is filtered client-side over the same page the
  // other tabs read; everything else pushes the filter to the server.
  const { data, isLoading, isError, refetch } = usePayments(
    filter === 'ALL' || filter === 'ATTENTION' ? {} : { status: filter },
  );

  const all = data?.data ?? [];
  const payments = filter === 'ATTENTION' ? all.filter(needsAttention) : all;
  const attentionCount = all.filter(needsAttention).length;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Finance · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Payments</h1>
          <p className="mt-2 text-sm text-muted">
            Every attempt to take money, and what happened to it.
          </p>
        </div>
        {data && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Showing</div>
            <div className="font-display text-3xl tabnum text-ink">{payments.length}</div>
          </div>
        )}
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
            {f.key === 'ATTENTION' && attentionCount > 0 && (
              <span className="ml-1.5 tabnum">({attentionCount})</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load payments"
          description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : payments.length === 0 ? (
        <EmptyState
          icon={filter === 'ATTENTION' ? <CreditCard className="h-8 w-8" /> : <CreditCard className="h-8 w-8" />}
          title={filter === 'ATTENTION' ? 'Nothing needs chasing' : 'No payments here'}
          description={
            filter === 'ATTENTION'
              ? 'No payment has failed or is mid-retry. Failed payments land here so nobody has to go looking for them — switch to All to see every payment taken.'
              : 'Payments appear here as soon as one is taken against a booking — from the cockpit, or by recording a payment on a pending booking.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-paper">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3.5 font-medium">Guest</th>
                <th className="px-4 py-3.5 font-medium">For</th>
                <th className="px-4 py-3.5 text-right font-medium">Amount</th>
                <th className="px-4 py-3.5 font-medium">Method</th>
                <th className="px-4 py-3.5 font-medium">Status</th>
                <th className="px-4 py-3.5 font-medium">Taken</th>
                <th className="px-4 py-3.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr
                  key={p.id}
                  className={cn(
                    'border-b border-line transition-colors duration-300 last:border-0 hover:bg-cream-2',
                    needsAttention(p) && 'bg-rose-50/50',
                  )}
                >
                  <td className="px-4 py-3.5">
                    <div className="text-ink">{p.guest_name ?? <span className="text-muted">—</span>}</div>
                    {p.unit_code && <div className="text-xs text-muted">{p.unit_code}</div>}
                  </td>
                  <td className="px-4 py-3.5 text-muted">{p.purpose === 'DEPOSIT' ? 'Deposit' : 'Balance'}</td>
                  <td className="px-4 py-3.5 text-right tabnum text-ink">{formatMoney(p.amount, p.currency)}</td>
                  <td className="px-4 py-3.5 text-muted">{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="px-4 py-3.5">
                    <Badge tone={statusTone[p.status]}>{statusLabel[p.status]}</Badge>
                    {p.attempts > 1 && (
                      <div className="mt-1 text-xs text-muted">
                        {p.attempts} of {p.max_attempts} tries
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-muted">{fmtDate(p.created_at)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => setOpenId(p.id)}>
                        View
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaymentDetailDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** The attempt-by-attempt story, and the error text the API has always recorded. */
function PaymentDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, isError } = usePayment(id);

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>
            {data?.guest_name ? `${data.guest_name}${data.unit_code ? ` · ${data.unit_code}` : ''}` : 'Every attempt, in order.'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center"><Spinner className="h-5 w-5" /></div>
        ) : isError || !data ? (
          <p className="text-sm text-muted">This payment couldn’t be loaded.</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2 text-sm">
              <Row label="Amount">{formatMoney(data.amount, data.currency)}</Row>
              <Row label="For">{data.purpose === 'DEPOSIT' ? 'Deposit' : 'Balance'}</Row>
              <Row label="Method">{METHOD_LABELS[data.method] ?? data.method}</Row>
              <Row label="Status">
                <Badge tone={statusTone[data.status]}>{statusLabel[data.status]}</Badge>
              </Row>
              {data.paid_at && <Row label="Paid">{fmtTime(data.paid_at)}</Row>}
            </div>

            {/* The reason this screen exists: the API records why a payment failed and
                nothing has ever displayed it. */}
            {data.last_error && (
              <div className="flex gap-2.5 rounded-md border border-rose-200 bg-rose-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-rose-700">Last failure</div>
                  <p className="mt-1 text-sm text-rose-800">{data.last_error}</p>
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted">
                Attempts ({data.attempts_log.length})
              </div>
              {data.attempts_log.length === 0 ? (
                <p className="text-sm text-muted">Nothing has been tried against this payment yet.</p>
              ) : (
                <ul className="flex flex-col">
                  {data.attempts_log.map((a) => (
                    <li key={a.id} className="flex items-baseline gap-3 border-b border-line py-2.5 last:border-0">
                      <span className="font-display text-xs italic text-terra">
                        {String(a.attempt_no).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink">
                          {a.outcome === 'SUCCESS' ? 'Succeeded' : a.outcome === 'FAILURE' ? 'Failed' : 'Started'}
                          {a.reference && <span className="text-muted"> · ref {a.reference}</span>}
                        </div>
                        {a.note && <div className="text-xs text-muted">{a.note}</div>}
                      </div>
                      <span className="shrink-0 text-[11px] uppercase tracking-[0.1em] text-faint">
                        {fmtTime(a.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* No "open the booking" link: ReservationsPage keeps its search in local
                state and does not read a query param, so the button would land on an
                unfiltered list. The guest and unit are in the header instead. */}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      <span className="font-medium text-ink">{children}</span>
    </div>
  );
}
