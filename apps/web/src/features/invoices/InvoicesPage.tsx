import { useEffect, useRef, useState } from 'react';
import { useSmallScreen } from '@/lib/utils/useSmallScreen';
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
import { fullRefundMessage } from '@/lib/api/errors';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { AmountError } from '@/components/ui/amount-error';
import { cn } from '@/lib/utils/cn';
import { Pager } from '@/components/ui/pager';
import { useInvoices, useSettleInvoice, useRefundInvoice, useActiveQuotes, useIssueInvoice } from './hooks';
import type { Invoice, InvoiceStatus } from '@/types';

// "Unpaid" is a server-side filter on OPEN receivables (ISSUED + PARTIALLY_PAID), not a
// single status: a part-paid booking's balance must show up under it too.
type Tab = 'ALL' | 'OUTSTANDING' | 'INCOMING' | 'OVERDUE' | 'PAID' | 'REFUNDED' | 'VOID';
const FILTERS: { key: Tab; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OUTSTANDING', label: 'Unpaid' },
  // Unpaid splits into the two questions Accounts asks: what's coming in, what's late.
  { key: 'INCOMING', label: 'Incoming' },
  { key: 'OVERDUE', label: 'Overdue' },
  { key: 'PAID', label: 'Paid' },
  { key: 'REFUNDED', label: 'Refunded' },
  { key: 'VOID', label: 'Void' },
];
const STATUS_TABS: Partial<Record<Tab, InvoiceStatus>> = { PAID: 'PAID', REFUNDED: 'REFUNDED', VOID: 'VOID' };

const kindTone = { DEPOSIT: 'blue', BALANCE: 'slate', REFUND: 'amber' } as const;
const statusTone = { ISSUED: 'amber', PARTIALLY_PAID: 'blue', PAID: 'green', REFUNDED: 'slate', VOID: 'slate' } as const;
const statusLabel: Record<InvoiceStatus, string> = {
  ISSUED: 'ISSUED', PARTIALLY_PAID: 'PART-PAID', PAID: 'PAID', REFUNDED: 'REFUNDED', VOID: 'VOID',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// A due date is a calendar day, not an instant — format it as that day in UTC so a
// browser in another timezone never shows the day before.
function fmtDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function InvoicesPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canSettle = hasPerm('invoices.update');
  const canRefund = hasPerm('invoices.refund');
  const canIssue = hasPerm('invoices.create');

  const [filter, setFilter] = useState<Tab>('ALL');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Wait for a pause in typing before asking the server, so each keystroke is not a query.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);
  const rangeInvalid = !!from && !!to && from > to;
  const [page, setPage] = useState(1);
  // A new tab, search or date range starts from page 1.
  useEffect(() => setPage(1), [filter, search, from, to]);
  const { data, isLoading, isError, refetch } = useInvoices({
    status: STATUS_TABS[filter],
    outstanding: filter === 'OUTSTANDING' ? true : undefined,
    overdue: filter === 'OVERDUE' ? true : undefined,
    incoming: filter === 'INCOMING' ? true : undefined,
    search: search || undefined,
    from: from && !rangeInvalid ? from : undefined,
    to: to && !rangeInvalid ? to : undefined,
    limit: 100,
    page,
  });
  const filtered = !!search || !!from || !!to || filter !== 'ALL';
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
  // One key per time the dialog opens: a double click, or a retry after a slow network,
  // replays the same refund instead of recording a second one. A fresh open = a new key.
  const [refundKey, setRefundKey] = useState('');
  // (R10 #1) The server's "this refunds everything and makes the stay free" question, asked
  // in the dialog and answered there.
  const [fullRefundQuestion, setFullRefundQuestion] = useState<string | null>(null);

  // A part-refunded invoice can be refunded again — but only up to what is left.
  const refundable = (inv: Invoice) => inv.total_amount - (inv.refunded_amount ?? 0);
  const openRefund = (inv: Invoice) => {
    setRefunding(inv);
    // (R10 #2) Empty, as on the booking: the limit is in the line above the box.
    setAmount('');
    setReason('');
    setFullRefundQuestion(null);
    setRefundKey(newIdempotencyKey());
  };

  // Valid = a real Pula amount (dot decimals, ≤ 2 places), above zero and no more than is
  // still refundable on this invoice. One rule for the button and for the submit.
  const refundThebe = pulaToThebe(amount);
  const refundAmountOk = !Number.isNaN(refundThebe) && refundThebe > 0 && !!refunding && refundThebe <= refundable(refunding);

  // (R5 retest) `refund.isPending` is read from the render the click happened in, so two
  // clicks in the same tick both saw false: the server's Idempotency-Key made it one refund,
  // but the replayed answer showed "Refund recorded" twice. A ref flips synchronously.
  const refundInFlight = useRef(false);
  const submitRefund = (confirmFullRefund = false) => {
    if (!refunding || refundInFlight.current || refund.isPending || !refundAmountOk || !reason.trim()) return;
    refundInFlight.current = true;
    refund.mutate(
      { id: refunding.id, amount: refundThebe, reason: reason.trim(), idempotencyKey: refundKey, confirmFullRefund },
      {
        onSuccess: () => setRefunding(null),
        onError: (e) => setFullRefundQuestion(fullRefundMessage(e)),
        onSettled: () => { refundInFlight.current = false; },
      },
    );
  };

  const invoices = data?.data ?? [];
  // (R6 #10) Below 640 px the table becomes one card per invoice — see useSmallScreen.
  const small = useSmallScreen();

  // The same three actions on the table row and on the phone card.
  const actionsFor = (inv: Invoice) => (
    <>
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
    </>
  );

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
            <div className="font-display text-3xl tabnum text-ink">
              {data.data.length}
              {data.total > data.data.length && <span className="text-base text-muted"> of {data.total}</span>}
            </div>
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

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-search">Search</Label>
          <Input
            id="inv-search" className="w-64" value={searchText} placeholder="Invoice, guest or unit"
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-from">Issued from</Label>
          <Input id="inv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-to">to</Label>
          <Input id="inv-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(searchText || from || to) && (
          <Button variant="outline" onClick={() => { setSearchText(''); setSearch(''); setFrom(''); setTo(''); }}>
            Clear
          </Button>
        )}
      </div>
      {rangeInvalid && <p role="alert" className="text-xs text-terra">The start date is after the end date.</p>}

      {data && data.totals.outstanding_count > 0 && (
        <div className="flex flex-wrap gap-6 rounded-lg border border-line bg-paper px-4 py-3 text-sm" title={data.totals.scope}>
          <div>
            <span className="text-muted">Unpaid in this view </span>
            <span className="tabnum text-ink">{formatMoney(data.totals.outstanding_amount, 'BWP')}</span>
            <span className="text-muted"> · {data.totals.outstanding_count}</span>
          </div>
          {data.totals.overdue_count > 0 && (
            <div>
              <span className="text-muted">Overdue </span>
              <span className="tabnum text-terra">{formatMoney(data.totals.overdue_amount, 'BWP')}</span>
              <span className="text-muted"> · {data.totals.overdue_count}</span>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load invoices"
          description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : invoices.length === 0 && filtered ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No invoices match"
          description="Nothing fits those filters in this property. Try another tab, a wider date range, or clear the search."
        />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No invoices yet"
          description="Recording a payment on a booking raises a paid receipt here automatically. You can also raise one by hand against a quote when a deposit or balance is due, then settle it here once the guest pays."
        />
      ) : small ? (
        <ul className="flex flex-col gap-3">
          {invoices.map((inv) => (
            <li key={inv.id} data-testid={`invoice-card-${inv.id}`} className="rounded-lg border border-line bg-paper p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-display text-base text-ink">{inv.number}</div>
                  <div className="text-sm text-char">{inv.bill_to_name ?? '—'}</div>
                  {inv.guest_name && inv.guest_name !== inv.bill_to_name && (
                    <div className="text-xs text-muted">for {inv.guest_name}</div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabnum font-display text-lg text-ink">{formatMoney(inv.total_amount, inv.currency)}</div>
                  <Badge tone={kindTone[inv.kind]}>{inv.kind}</Badge>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone={statusTone[inv.status]}>{statusLabel[inv.status]}</Badge>
                {inv.is_overdue && <Badge tone="rose">OVERDUE</Badge>}
                {inv.status === 'PAID' && inv.refunded_amount > 0 && (
                  <span className="text-xs text-muted">{formatMoney(inv.refunded_amount, inv.currency)} refunded</span>
                )}
              </div>
              <div className="mt-2 text-xs text-muted">
                {inv.unit_code && (
                  <span>
                    {inv.unit_code}
                    {inv.check_in_date && inv.check_out_date && ` · ${fmtDate(inv.check_in_date)} → ${fmtDate(inv.check_out_date)}`}
                    {' · '}
                  </span>
                )}
                <span>Issued {fmtDate(inv.created_at)}</span>
                {inv.due_date && inv.kind !== 'REFUND' && (
                  <span className={cn(inv.is_overdue && 'text-terra')}> · Due {fmtDay(inv.due_date)}</span>
                )}
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">{actionsFor(inv)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-paper">
          <table className="min-w-[40rem] whitespace-nowrap md:whitespace-normal w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                <th className="px-4 py-3.5 font-medium">Invoice</th>
                <th className="px-4 py-3.5 font-medium">Bill to</th>
                <th className="px-4 py-3.5 font-medium">Stay</th>
                <th className="px-4 py-3.5 font-medium">Type</th>
                <th className="px-4 py-3.5 text-right font-medium">Amount</th>
                <th className="px-4 py-3.5 font-medium">Status</th>
                <th className="px-4 py-3.5 font-medium">Issued</th>
                <th className="px-4 py-3.5 font-medium">Due</th>
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
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={statusTone[inv.status]}>{statusLabel[inv.status]}</Badge>
                      {inv.is_overdue && <Badge tone="rose">OVERDUE</Badge>}
                    </div>
                    {inv.status === 'PAID' && inv.refunded_amount > 0 && (
                      <div className="mt-0.5 text-xs text-muted">{formatMoney(inv.refunded_amount, inv.currency)} refunded</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-muted">{fmtDate(inv.created_at)}</td>
                  <td className={cn('px-4 py-3.5', inv.is_overdue ? 'text-terra' : 'text-muted')}>
                    {inv.due_date && inv.kind !== 'REFUND' ? fmtDay(inv.due_date) : '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end gap-2">{actionsFor(inv)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} limit={data.limit} total={data.total} onPage={setPage} />}

      <Dialog open={!!refunding} onOpenChange={(o) => !o && setRefunding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund {refunding?.number}</DialogTitle>
            <DialogDescription>
              Records a refund against this payment. Up to {refunding ? formatMoney(refundable(refunding), refunding.currency) : ''} can still be refunded
              {refunding && refunding.refunded_amount > 0 ? ` (${formatMoney(refunding.refunded_amount, refunding.currency)} already refunded)` : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="refund-amount">Amount (Pula)</Label>
              <Input
                id="refund-amount"
                inputMode="decimal"
                value={amount}
                placeholder={refunding ? `up to ${thebeToPula(refundable(refunding))}` : ''}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setFullRefundQuestion(null);
                }}
              />
              <AmountError value={amount} positive />
              {!Number.isNaN(refundThebe) && refunding && refundThebe > refundable(refunding) && (
                <p role="alert" className="text-[11px] text-terra">
                  Only {formatMoney(refundable(refunding), refunding.currency)} can still be refunded on this invoice.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="refund-reason">Reason</Label>
              <Input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. guest cancelled within policy" />
            </div>
            {fullRefundQuestion ? (
              <div role="alert" className="flex flex-col gap-2 rounded-md border border-terra/40 bg-terra/5 p-3">
                <p className="text-sm text-terra">{fullRefundQuestion}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setFullRefundQuestion(null)}>Don’t refund</Button>
                  <Button
                    variant="danger"
                    disabled={busy || refund.isPending || !reason.trim() || !refundAmountOk}
                    onClick={() => submitRefund(true)}
                  >
                    Yes — refund anyway
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRefunding(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  disabled={busy || refund.isPending || !reason.trim() || !refundAmountOk}
                  onClick={() => submitRefund()}
                >
                  Record refund
                </Button>
              </div>
            )}
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
