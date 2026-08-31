import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { formatMoney } from '@/lib/utils/money';
import { useInvoiceDocument, useSendInvoice } from './hooks';
import type { InvoiceDocument } from '@/types';

// Company header on the document. Edit here (or wire to settings later).
const BRAND = {
  name: 'Lifestyle Apartments',
  tagline: 'Serviced Apartments · Gaborone, Botswana',
};

function docTitle(d: InvoiceDocument): string {
  if (d.kind === 'REFUND') return 'Credit Note';
  if (d.status === 'PAID') return 'Receipt';
  return 'Invoice';
}

function lineDescription(d: InvoiceDocument): string {
  const unit = d.unit_type ? `${d.unit_type.charAt(0)}${d.unit_type.slice(1).toLowerCase()}` : 'Apartment';
  const nights = d.nights ? ` · ${d.nights} night${d.nights === 1 ? '' : 's'}` : '';
  const kind = d.kind === 'DEPOSIT' ? 'Deposit' : d.kind === 'BALANCE' ? 'Balance' : 'Refund';
  return `${kind} — ${unit} stay${nights}`;
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export function InvoiceDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: d, isLoading, isError } = useInvoiceDocument(id ?? '');
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const send = useSendInvoice();

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  if (isError || !d) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <EmptyState title="Couldn’t load invoice" description="It may not exist, or you don’t have access."
          action={<Button variant="outline" onClick={() => navigate('/invoices')}>Back to invoices</Button>} />
      </div>
    );
  }

  const taxPct = (d.tax_rate_bps / 100).toFixed(d.tax_rate_bps % 100 === 0 ? 0 : 1);

  return (
    <div className="min-h-screen bg-cream-2 py-6 print:bg-white print:py-0">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 16mm; } }`}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[760px] items-center justify-between px-4">
        <Button variant="outline" onClick={() => navigate('/invoices')}><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
        <div className="flex gap-2">
          {hasPerm('invoices.update') && d.bill_to_email && (
            <Button variant="outline" disabled={send.isPending} onClick={() => send.mutate(d.id)}>
              <Mail className="mr-1.5 h-4 w-4" />
              {send.isPending ? 'Sending…' : d.bill_to_email === d.guest_email ? 'Email to guest' : 'Email to billing contact'}
            </Button>
          )}
          <Button variant="primary" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" />Print / Save as PDF</Button>
        </div>
      </div>

      <article className="mx-auto max-w-[760px] bg-white p-10 text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        {/* Header */}
        <header className="flex items-start justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="font-display text-2xl text-slate-900">{BRAND.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{BRAND.tagline}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{docTitle(d)}</div>
            <div className="font-display text-xl text-slate-900">{d.number}</div>
            <div className="mt-1 text-xs text-slate-500">{fmtDate(d.created_at)}</div>
          </div>
        </header>

        {/* Parties + stay */}
        <section className="grid grid-cols-2 gap-6 py-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Billed to</div>
            <div className="mt-1.5 text-sm text-slate-900">{d.bill_to_name ?? d.guest_name ?? 'Guest'}</div>
            {d.bill_to_email && <div className="text-sm text-slate-500">{d.bill_to_email}</div>}
            {d.bill_to_name && d.guest_name && d.bill_to_name !== d.guest_name && (
              <div className="mt-1 text-xs text-slate-400">Guest: {d.guest_name}</div>
            )}
          </div>
          {(d.unit_code || d.check_in_date) && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Stay</div>
              {d.unit_code && <div className="mt-1.5 text-sm text-slate-900">{d.unit_name ?? d.unit_code}</div>}
              {d.check_in_date && <div className="text-sm text-slate-500">{fmtDate(d.check_in_date)} → {fmtDate(d.check_out_date)}</div>}
            </div>
          )}
        </section>

        {/* Lines */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-left text-[11px] uppercase tracking-[0.16em] text-slate-400">
              <th className="py-2.5 font-medium">Description</th>
              <th className="py-2.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="py-3 text-slate-900">{lineDescription(d)}</td>
              <td className="py-3 text-right tabnum text-slate-900">{formatMoney(d.subtotal_amount, d.currency)}</td>
            </tr>
          </tbody>
        </table>

        {/* Totals */}
        <div className="ml-auto mt-4 w-64 text-sm">
          {d.tax_amount > 0 && (
            <>
              <div className="flex justify-between py-1 text-slate-500"><span>Subtotal</span><span className="tabnum">{formatMoney(d.subtotal_amount, d.currency)}</span></div>
              <div className="flex justify-between py-1 text-slate-500"><span>VAT ({taxPct}%)</span><span className="tabnum">{formatMoney(d.tax_amount, d.currency)}</span></div>
            </>
          )}
          <div className="mt-1 flex justify-between border-t border-slate-300 py-2 text-base font-medium text-slate-900"><span>Total</span><span className="tabnum">{formatMoney(d.total_amount, d.currency)}</span></div>
        </div>

        {/* Status */}
        <div className="mt-6">
          {d.status === 'PAID' && <span className="inline-block rounded-md border-2 border-emerald-600 px-3 py-1 text-sm font-medium uppercase tracking-wide text-emerald-700">Paid</span>}
          {d.status === 'ISSUED' && <span className="inline-block rounded-md border-2 border-amber-800 px-3 py-1 text-sm font-medium uppercase tracking-wide text-amber-800">Due</span>}
          {d.status === 'REFUNDED' && <span className="inline-block rounded-md border-2 border-rose-600 px-3 py-1 text-sm font-medium uppercase tracking-wide text-rose-700">Refunded</span>}
        </div>

        <footer className="mt-10 border-t border-slate-200 pt-5 text-xs text-slate-400">
          Thank you for staying with {BRAND.name}. All amounts in {d.currency}. This document was generated by the Lifestyle Operations Platform.
        </footer>
      </article>
    </div>
  );
}
