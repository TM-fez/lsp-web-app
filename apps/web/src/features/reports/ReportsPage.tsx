import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { todayISO } from '@/lib/utils/date';
import { usePnl, useNudges } from './hooks';
import { downloadPnlCsv } from './csv';
import type { MonthlyPoint, PropertyPnl } from '@/types';
import type { Nudge } from '@/lib/api/reports';

// ── palette (matches the editorial theme tokens) ──────────────────────────────
const FOREST = '#22402F';
const TERRA = '#B5552D';
const LINE = '#E4DDD0';
const MUTED = '#8E8576';

const PERIODS = [
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
] as const;

function windowFor(months: number): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  return { from: from.toISOString().slice(0, 10), to: todayISO() };
}

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

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleString('en', { month: 'short' });
}

// ── Revenue vs cost, grouped bars per month (bespoke SVG, no chart lib) ────────
function MonthlyChart({ data }: { data: MonthlyPoint[] }) {
  const W = 760, H = 240, padL = 46, padR = 10, padT = 14, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const cost = (d: MonthlyPoint) => d.maintenance_cost + d.operating_expenses;
  const max = Math.max(1, ...data.map((d) => Math.max(d.revenue, cost(d))));
  const groupW = innerW / data.length;
  const barW = Math.min(13, groupW / 3.2);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const gridVals = [0, max / 2, max];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
      aria-label="Monthly revenue versus total cost across the selected period.">
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={LINE} strokeWidth={1} />
          <text x={padL - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill={MUTED}>{compactPula(v)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const gx = padL + i * groupW + groupW / 2;
        const c = cost(d);
        const net = d.revenue - c;
        return (
          <g key={d.month}>
            <rect x={gx - barW - 1.5} y={y(d.revenue)} width={barW} height={Math.max(0, y(0) - y(d.revenue))} fill={FOREST} rx={1.5}>
              <title>{`${monthLabel(d.month)} ${d.month.slice(0, 4)} — revenue ${fullPula(d.revenue)} · cost ${fullPula(c)} · net ${fullPula(net)}`}</title>
            </rect>
            <rect x={gx + 1.5} y={y(c)} width={barW} height={Math.max(0, y(0) - y(c))} fill={TERRA} rx={1.5}>
              <title>{`${monthLabel(d.month)} ${d.month.slice(0, 4)} — cost ${fullPula(c)}`}</title>
            </rect>
            <text x={gx} y={H - 10} textAnchor="middle" fontSize={10} fill={MUTED}>{monthLabel(d.month)}</text>
          </g>
        );
      })}
    </svg>
  );
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

export function ReportsPage() {
  const [months, setMonths] = useState<number>(12);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const useCustom = !!(customFrom && customTo && customFrom <= customTo);
  const preset = windowFor(months);
  const from = useCustom ? customFrom : preset.from;
  const to = useCustom ? customTo : preset.to;

  const { data, isLoading, isError, refetch } = usePnl({ from, to });
  const { data: nudges } = useNudges();
  const s = data?.summary;

  const openStatement = () => window.open(`/reports/print?from=${from}&to=${to}`, '_blank');

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Finance · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Reports</h1>
          <p className="mt-2 text-sm text-muted">Revenue, costs and occupancy across the estate.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.months}
              type="button"
              onClick={() => { setMonths(p.months); setCustomFrom(''); setCustomTo(''); }}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs transition-[background-color,color,border-color] duration-300',
                months === p.months && !useCustom ? 'border-forest bg-forest text-cream' : 'border-line bg-paper text-char hover:border-ink',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {nudges && nudges.length > 0 && <NudgeStrip nudges={nudges} />}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] uppercase tracking-[0.18em] text-muted">Custom range</span>
        <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-40" />
        <span className="text-muted">→</span>
        <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-40" />
        {useCustom && (
          <button type="button" onClick={() => { setCustomFrom(''); setCustomTo(''); }} className="text-xs text-terra hover:underline">Clear</button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" disabled={!data} onClick={() => data && downloadPnlCsv(data, from, to)}>
            <Download className="mr-1.5 h-3.5 w-3.5" />Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={openStatement}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />Print statement
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-60 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError || !data || !s ? (
        <EmptyState
          title="Couldn’t load reports"
          description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label="Revenue" value={compactPula(s.revenue)} sub={fullPula(s.revenue)} />
            <Metric label="Total cost" value={compactPula(s.total_cost)}
              sub={`maint ${compactPula(s.maintenance_cost)} · opex ${compactPula(s.operating_expenses)}`} />
            <Metric label="Net margin" value={compactPula(s.net)} sub={`${s.margin_pct}% of revenue`}
              tone={s.net >= 0 ? 'pos' : 'neg'} />
            <Metric label="VAT collected" value={compactPula(s.vat_output)} sub="output VAT for BURS" />
            <Metric label="Occupancy" value={`${s.occupancy_pct}%`}
              sub={`${s.room_nights_booked.toLocaleString('en')} of ${s.room_nights_available.toLocaleString('en')} nights`} />
          </div>

          <section className="rounded-lg border border-line bg-paper p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl text-ink">Revenue vs cost</h2>
              <div className="flex items-center gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: FOREST }} /> Revenue</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: TERRA }} /> Cost</span>
              </div>
            </div>
            {data.monthly.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No data in this period.</p>
            ) : (
              <MonthlyChart data={data.monthly} />
            )}
          </section>

          <section>
            <h2 className="mb-3 font-display text-xl text-ink">By property</h2>
            <div className="overflow-hidden rounded-lg border border-line bg-paper">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                    <th className="px-4 py-3.5 font-medium">Property</th>
                    <th className="px-4 py-3.5 text-right font-medium">Revenue</th>
                    <th className="px-4 py-3.5 text-right font-medium">Maintenance</th>
                    <th className="px-4 py-3.5 text-right font-medium">Operating</th>
                    <th className="px-4 py-3.5 text-right font-medium">Net</th>
                    <th className="px-4 py-3.5 text-right font-medium">Occupancy</th>
                    <th className="px-4 py-3.5 text-right font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data.by_property.map((p: PropertyPnl) => (
                    <tr key={p.property_id ?? 'company'} className="border-b border-line last:border-0 hover:bg-cream-2">
                      <td className="px-4 py-3.5 font-display text-lg text-ink">{p.property_name}</td>
                      <td className="px-4 py-3.5 text-right tabnum text-ink" title={fullPula(p.revenue)}>{compactPula(p.revenue)}</td>
                      <td className="px-4 py-3.5 text-right tabnum text-muted" title={fullPula(p.maintenance_cost)}>{compactPula(p.maintenance_cost)}</td>
                      <td className="px-4 py-3.5 text-right tabnum text-muted" title={fullPula(p.operating_expenses)}>{compactPula(p.operating_expenses)}</td>
                      <td className={cn('px-4 py-3.5 text-right tabnum', p.net >= 0 ? 'text-forest' : 'text-terra')} title={fullPula(p.net)}>{compactPula(p.net)}</td>
                      <td className="px-4 py-3.5 text-right tabnum text-muted">{p.occupancy_pct === null ? '—' : `${p.occupancy_pct}%`}</td>
                      <td className="px-4 py-3.5 text-right">
                        {p.property_id && (
                          <button type="button" onClick={() => window.open(`/reports/print?from=${from}&to=${to}&property_id=${p.property_id}`, '_blank')}
                            className="text-xs text-forest hover:underline">Statement</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// H6 — occupancy nudges: what a revenue manager would notice, one line each.
// Rule-based on forward 7/30-day demand (the pre-AI Strategy Engine).
function NudgeStrip({ nudges }: { nudges: Nudge[] }) {
  return (
    <div className="grid animate-rise gap-3 sm:grid-cols-2">
      {nudges.map((n) => (
        <div
          key={`${n.property_id}:${n.title}`}
          className={cn(
            'rounded-lg border p-4',
            n.tone === 'opportunity' ? 'border-forest/30 bg-forest/5' : 'border-line bg-paper',
          )}
        >
          <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted">
            {n.tone === 'opportunity' ? 'Opportunity' : 'Heads up'}
          </div>
          <div className="font-display text-lg text-ink">{n.title}</div>
          <p className="mt-1 text-sm text-char">{n.detail}</p>
        </div>
      ))}
    </div>
  );
}
