import { useSearchParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/utils/money';
import { usePnl } from './hooks';

const BRAND = { name: 'Lifestyle Apartments', tagline: 'Serviced Apartments · Gaborone, Botswana' };
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};

export function ReportStatementPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const propertyId = params.get('property_id') ?? undefined;

  const { data, isLoading, isError } = usePnl({ from, to, property_id: propertyId });

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <EmptyState title="Couldn’t load statement" description="Try again from the Reports page."
          action={<Button variant="outline" onClick={() => navigate('/reports')}>Back to reports</Button>} />
      </div>
    );
  }

  const s = data.summary;
  const ownerProperty = propertyId ? data.by_property[0]?.property_name : null;
  const title = ownerProperty ? `Owner Statement — ${ownerProperty}` : 'Profit & Loss Statement';
  const row = (label: string, thebe: number, strong = false) => (
    <div className={`flex justify-between py-1.5 ${strong ? 'border-t border-slate-300 font-medium text-slate-900' : 'text-slate-600'}`}>
      <span>{label}</span><span className="tabnum">{formatMoney(thebe, 'BWP')}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-cream-2 py-6 print:bg-white print:py-0">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 16mm; } }`}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[820px] items-center justify-between px-4">
        <Button variant="outline" onClick={() => navigate('/reports')}><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
        <Button variant="primary" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" />Print / Save as PDF</Button>
      </div>

      <article className="mx-auto max-w-[820px] bg-white p-10 text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="font-display text-2xl text-slate-900">{BRAND.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{BRAND.tagline}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{title}</div>
            <div className="mt-1 text-sm text-slate-600">{from ? fmtDate(from) : '—'} → {to ? fmtDate(to) : '—'}</div>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-10 py-6">
          <section>
            <h2 className="mb-2 font-display text-lg text-slate-900">Summary</h2>
            {row('Revenue', s.revenue)}
            {row('Maintenance cost', s.maintenance_cost)}
            {row('Operating expenses', s.operating_expenses)}
            {row('Net', s.net, true)}
            <div className="mt-3 flex justify-between py-1.5 text-sm text-slate-500"><span>Margin</span><span className="tabnum">{s.margin_pct}%</span></div>
            <div className="flex justify-between py-1.5 text-sm text-slate-500"><span>VAT collected (output)</span><span className="tabnum">{formatMoney(s.vat_output, 'BWP')}</span></div>
            <div className="flex justify-between py-1.5 text-sm text-slate-500"><span>Occupancy</span><span className="tabnum">{s.occupancy_pct}%</span></div>
          </section>

          <section>
            <h2 className="mb-2 font-display text-lg text-slate-900">Monthly net</h2>
            <table className="w-full text-sm">
              <tbody>
                {data.monthly.filter((m) => m.revenue || m.net).map((m) => (
                  <tr key={m.month} className="border-b border-slate-100">
                    <td className="py-1.5 text-slate-600">{monthLabel(m.month)}</td>
                    <td className="py-1.5 text-right tabnum text-slate-500">{formatMoney(m.revenue, 'BWP')}</td>
                    <td className="py-1.5 text-right tabnum text-slate-900">{formatMoney(m.net, 'BWP')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        {!ownerProperty && (
          <section className="pt-2">
            <h2 className="mb-2 font-display text-lg text-slate-900">By property</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
                  <th className="py-2 font-medium">Property</th>
                  <th className="py-2 text-right font-medium">Revenue</th>
                  <th className="py-2 text-right font-medium">Cost</th>
                  <th className="py-2 text-right font-medium">Net</th>
                  <th className="py-2 text-right font-medium">Occ.</th>
                </tr>
              </thead>
              <tbody>
                {data.by_property.map((p) => (
                  <tr key={p.property_id ?? 'company'} className="border-b border-slate-100">
                    <td className="py-2 text-slate-900">{p.property_name}</td>
                    <td className="py-2 text-right tabnum text-slate-600">{formatMoney(p.revenue, 'BWP')}</td>
                    <td className="py-2 text-right tabnum text-slate-600">{formatMoney(p.maintenance_cost + p.operating_expenses, 'BWP')}</td>
                    <td className="py-2 text-right tabnum text-slate-900">{formatMoney(p.net, 'BWP')}</td>
                    <td className="py-2 text-right tabnum text-slate-500">{p.occupancy_pct === null ? '—' : `${p.occupancy_pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="mt-10 border-t border-slate-200 pt-5 text-xs text-slate-400">
          Generated by the Lifestyle Operations Platform · All amounts in BWP. Revenue recognised on payment; VAT shown is output VAT collected on paid invoices.
        </footer>
      </article>
    </div>
  );
}
