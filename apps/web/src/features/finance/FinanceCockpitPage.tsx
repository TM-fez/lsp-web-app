import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { useReceivables } from './hooks';
import type { AgingBucket, AgingBucketKey, OutstandingInvoice, PropertyReceivable } from '@/types';

// Ageing runs fresh → stale: forest (current) through terra to a deep red (90+).
const AGING: Record<AgingBucketKey, { label: string; color: string }> = {
  '0-30': { label: '0–30 days', color: '#22402F' },
  '31-60': { label: '31–60 days', color: '#6B7B3A' },
  '61-90': { label: '61–90 days', color: '#B5552D' },
  '90+': { label: '90+ days', color: '#8A2D1F' },
};

function compactPula(thebe: number): string {
  const p = thebe / 100;
  const a = Math.abs(p);
  const sign = p < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}P${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}P${Math.round(a / 1_000)}k`;
  return `${sign}P${Math.round(a)}`;
}

function fullPula(thebe: number): string {
  return `P${(thebe / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-lg border border-line bg-paper p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={cn('mt-2 font-display text-3xl tabnum',
        tone === 'neg' ? 'text-terra' : tone === 'pos' ? 'text-forest' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

// Proportional stacked bar across the four ageing buckets (bespoke SVG, no chart lib).
function AgingBar({ aging, total }: { aging: AgingBucket[]; total: number }) {
  const W = 760, H = 26;
  let x = 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-full" role="img"
      aria-label="Outstanding receivables split across ageing buckets.">
      {aging.map((b) => {
        const w = total > 0 ? (b.amount / total) * W : 0;
        const seg = (
          <rect key={b.bucket} x={x} y={0} width={Math.max(0, w)} height={H} fill={AGING[b.bucket].color}>
            <title>{`${AGING[b.bucket].label} — ${fullPula(b.amount)} (${b.count})`}</title>
          </rect>
        );
        x += w;
        return seg;
      })}
    </svg>
  );
}

export function FinanceCockpitPage() {
  const { data, isLoading, isError, refetch } = useReceivables();
  const s = data?.summary;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Finance · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Financial Cockpit</h1>
          <p className="mt-2 text-sm text-muted">Outstanding balances and receivables across the estate.</p>
        </div>
      </header>

      {isLoading ? (
        <div className="flex h-60 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError || !data || !s ? (
        <EmptyState
          title="Couldn’t load the cockpit"
          description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Total outstanding" value={compactPula(s.total_receivable)} sub={fullPula(s.total_receivable)} />
            <Metric label="Open invoices" value={s.open_invoices.toLocaleString('en')} sub="awaiting payment" />
            <Metric label="Oldest debt" value={s.oldest_days > 0 ? `${s.oldest_days}d` : '—'}
              sub={s.oldest_days > 0 ? 'since issue' : 'nothing outstanding'}
              tone={s.oldest_days > 90 ? 'neg' : undefined} />
            <Metric label="Refunds payable" value={compactPula(s.refunds_payable)}
              sub="owed back to guests" tone={s.refunds_payable > 0 ? 'neg' : undefined} />
          </div>

          {s.total_receivable === 0 ? (
            <EmptyState
              title="All settled"
              description="There are no outstanding receivables for your properties right now."
            />
          ) : (
            <>
              <section className="rounded-lg border border-line bg-paper p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-xl text-ink">Ageing</h2>
                  <span className="text-xs text-muted">by time since the invoice was issued</span>
                </div>
                <AgingBar aging={data.aging} total={s.total_receivable} />
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {data.aging.map((b) => (
                    <div key={b.bucket} className="flex items-start gap-2">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: AGING[b.bucket].color }} />
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{AGING[b.bucket].label}</div>
                        <div className="tabnum text-ink" title={fullPula(b.amount)}>{compactPula(b.amount)}</div>
                        <div className="text-xs text-muted">{b.count} {b.count === 1 ? 'invoice' : 'invoices'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="mb-3 font-display text-xl text-ink">By property</h2>
                <div className="overflow-hidden rounded-lg border border-line bg-paper">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                        <th className="px-4 py-3.5 font-medium">Property</th>
                        <th className="px-4 py-3.5 text-right font-medium">Outstanding</th>
                        <th className="px-4 py-3.5 text-right font-medium">Invoices</th>
                        <th className="px-4 py-3.5 text-right font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_property.map((p: PropertyReceivable) => (
                        <tr key={p.property_id ?? 'unattributed'} className="border-b border-line last:border-0 hover:bg-cream-2">
                          <td className="px-4 py-3.5 font-display text-lg text-ink">{p.property_name}</td>
                          <td className="px-4 py-3.5 text-right tabnum text-ink" title={fullPula(p.amount)}>{compactPula(p.amount)}</td>
                          <td className="px-4 py-3.5 text-right tabnum text-muted">{p.count}</td>
                          <td className="px-4 py-3.5 text-right tabnum text-muted">
                            {s.total_receivable > 0 ? `${Math.round((p.amount / s.total_receivable) * 100)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className="mb-3 font-display text-xl text-ink">Outstanding invoices</h2>
                <div className="overflow-hidden rounded-lg border border-line bg-paper">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                        <th className="px-4 py-3.5 font-medium">Invoice</th>
                        <th className="px-4 py-3.5 font-medium">Bill to</th>
                        <th className="px-4 py-3.5 font-medium">Property</th>
                        <th className="px-4 py-3.5 text-right font-medium">Age</th>
                        <th className="px-4 py-3.5 text-right font-medium">Amount</th>
                        <th className="px-4 py-3.5 text-right font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.invoices.map((i: OutstandingInvoice) => (
                        <tr key={i.id} className="border-b border-line last:border-0 hover:bg-cream-2">
                          <td className="px-4 py-3.5 tabnum text-ink">
                            {i.number}
                            <span className="ml-2 text-[11px] uppercase tracking-[0.14em] text-muted">{i.kind}</span>
                          </td>
                          <td className="px-4 py-3.5 text-char">{i.bill_to_name ?? '—'}</td>
                          <td className="px-4 py-3.5 text-muted">{i.property_name ?? 'Unattributed'}</td>
                          <td className={cn('px-4 py-3.5 text-right tabnum', i.days_outstanding > 90 ? 'text-terra' : 'text-muted')}>
                            {i.days_outstanding}d
                          </td>
                          <td className="px-4 py-3.5 text-right tabnum text-ink" title={fullPula(i.total_amount)}>{compactPula(i.total_amount)}</td>
                          <td className="px-4 py-3.5 text-right">
                            <button type="button" onClick={() => window.open(`/invoices/${i.id}/print`, '_blank')}
                              className="text-xs text-forest hover:underline">View</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
