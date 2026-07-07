import { useSearchParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/utils/money';
import { useOwners } from './hooks';

const BRAND = { name: 'Lifestyle Apartments', tagline: 'Serviced Apartments · Gaborone, Botswana' };
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export function OwnerStatementPrintPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const landlord = params.get('landlord') ?? '';

  const { data, isLoading, isError } = useOwners({ from, to });
  const owner = data?.owners.find((o) => o.landlord_name === landlord);

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  if (isError || !data || !owner) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <EmptyState title="Couldn’t load statement" description="Try again from the Owner statements page."
          action={<Button variant="outline" onClick={() => navigate('/owners')}>Back to owner statements</Button>} />
      </div>
    );
  }

  const row = (label: string, thebe: number, strong = false) => (
    <div className={`flex justify-between py-1.5 ${strong ? 'border-t border-slate-300 font-medium text-slate-900' : 'text-slate-600'}`}>
      <span>{label}</span><span className="tabnum">{formatMoney(thebe, 'BWP')}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-cream-2 py-6 print:bg-white print:py-0">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 16mm; } }`}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[820px] items-center justify-between px-4">
        <Button variant="outline" onClick={() => navigate('/owners')}><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
        <Button variant="primary" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" />Print / Save as PDF</Button>
      </div>

      <article className="mx-auto max-w-[820px] bg-white p-10 text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="font-display text-2xl text-slate-900">{BRAND.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{BRAND.tagline}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Owner Statement</div>
            <div className="mt-1 text-sm text-slate-600">{from ? fmtDate(from) : '—'} → {to ? fmtDate(to) : '—'}</div>
          </div>
        </header>

        <section className="flex items-start justify-between gap-8 py-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Payable to</div>
            <div className="mt-1 font-display text-xl text-slate-900">{owner.landlord_name}</div>
            {owner.landlord_phone && <div className="mt-0.5 text-sm text-slate-500">{owner.landlord_phone}</div>}
            <div className="mt-1 text-sm text-slate-500">
              {owner.unit_count} unit{owner.unit_count === 1 ? '' : 's'} · {owner.occupancy_pct}% occupancy
            </div>
          </div>
          <div className="w-72">
            {row('Revenue earned', owner.revenue)}
            {row('Less owner-charged costs', -owner.maintenance_cost)}
            {row('Net payout', owner.net, true)}
          </div>
        </section>

        <section className="pt-2">
          <h2 className="mb-2 font-display text-lg text-slate-900">Per unit</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-200 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
                <th className="py-2 font-medium">Unit</th>
                <th className="py-2 font-medium">Property</th>
                <th className="py-2 text-right font-medium">Revenue</th>
                <th className="py-2 text-right font-medium">Nights</th>
                <th className="py-2 text-right font-medium">Occ.</th>
                <th className="py-2 text-right font-medium">Costs</th>
                <th className="py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {owner.units.map((u) => (
                <tr key={u.room_id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-900">{u.room_code ?? u.room_name}</td>
                  <td className="py-2 text-slate-600">{u.property_name}</td>
                  <td className="py-2 text-right tabnum text-slate-600">{formatMoney(u.revenue, 'BWP')}</td>
                  <td className="py-2 text-right tabnum text-slate-500">{u.nights}</td>
                  <td className="py-2 text-right tabnum text-slate-500">{u.occupancy_pct}%</td>
                  <td className="py-2 text-right tabnum text-slate-600">{formatMoney(u.maintenance_cost, 'BWP')}</td>
                  <td className="py-2 text-right tabnum text-slate-900">{formatMoney(u.net, 'BWP')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300 font-medium text-slate-900">
                <td className="py-2" colSpan={2}>Total</td>
                <td className="py-2 text-right tabnum">{formatMoney(owner.revenue, 'BWP')}</td>
                <td className="py-2 text-right tabnum">{owner.nights}</td>
                <td className="py-2 text-right tabnum text-slate-500">{owner.occupancy_pct}%</td>
                <td className="py-2 text-right tabnum">{formatMoney(owner.maintenance_cost, 'BWP')}</td>
                <td className="py-2 text-right tabnum">{formatMoney(owner.net, 'BWP')}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <footer className="mt-10 border-t border-slate-200 pt-5 text-xs text-slate-400">
          Generated by the Lifestyle Operations Platform · All amounts in BWP. Revenue recognised on payment (PAID invoices);
          costs are approved repair spend charged to the owner. Net payout is revenue less those costs.
        </footer>
      </article>
    </div>
  );
}
