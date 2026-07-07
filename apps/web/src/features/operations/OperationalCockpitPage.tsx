import { useState } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { useOperations } from './hooks';
import type { OpsMonthlyPoint, OpsPropertyRow } from '@/types';

// ── palette (matches the editorial theme tokens, mirrors ReportsPage) ──────────
const FOREST = '#22402F';
const LINE = '#E4DDD0';
const MUTED = '#8E8576';

const PERIODS = [
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
] as const;

function compactPula(thebe: number): string {
  const p = thebe / 100;
  const a = Math.abs(p);
  const sign = p < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}P${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}P${Math.round(a / 1_000)}k`;
  return `${sign}P${Math.round(a)}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleString('en', { month: 'short' });
}

// A year-over-year change chip: green up / terra down / muted flat, or "no prior
// year" when the comparison window had no data to divide by.
function Delta({ value, unit }: { value: number | null; unit: 'pts' | 'pct' }) {
  if (value === null) return <span className="text-xs text-muted">no prior year</span>;
  const tone = value > 0 ? 'text-forest' : value < 0 ? 'text-terra' : 'text-muted';
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : null;
  const label = unit === 'pts' ? `${value > 0 ? '+' : ''}${value} pts` : `${value > 0 ? '+' : ''}${value}%`;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs', tone)}>
      {Icon && <Icon className="h-3 w-3" />}
      <span>{label}</span>
      <span className="ml-1 text-muted">YoY</span>
    </span>
  );
}

function OpsMetric({ label, value, sub, delta, unit }: {
  label: string; value: string; sub?: string; delta: number | null; unit: 'pts' | 'pct';
}) {
  return (
    <div className="rounded-lg border border-line bg-paper p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 font-display text-3xl tabnum text-ink">{value}</div>
      <div className="mt-1"><Delta value={delta} unit={unit} /></div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

// Monthly occupancy %, one bar per month (bespoke SVG, no chart lib).
function OccupancyChart({ data }: { data: OpsMonthlyPoint[] }) {
  const W = 760, H = 220, padL = 38, padR = 10, padT = 14, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(100, ...data.map((d) => d.occupancy_pct));
  const groupW = innerW / data.length;
  const barW = Math.min(24, groupW * 0.6);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const grid = [0, max / 2, max];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
      aria-label="Monthly occupancy percentage across the selected period.">
      {grid.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={LINE} strokeWidth={1} />
          <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill={MUTED}>{Math.round(v)}%</text>
        </g>
      ))}
      {data.map((d, i) => {
        const gx = padL + i * groupW + groupW / 2;
        return (
          <g key={d.month}>
            <rect x={gx - barW / 2} y={y(d.occupancy_pct)} width={barW} height={Math.max(0, y(0) - y(d.occupancy_pct))} fill={FOREST} rx={1.5}>
              <title>{`${monthLabel(d.month)} ${d.month.slice(0, 4)} — ${d.occupancy_pct}% · ${d.room_nights_booked} of ${d.room_nights_available} nights`}</title>
            </rect>
            <text x={gx} y={H - 10} textAnchor="middle" fontSize={10} fill={MUTED}>{monthLabel(d.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function OperationalCockpitPage() {
  const [months, setMonths] = useState<number>(12);
  const { data, isLoading, isError, refetch } = useOperations({ months });
  const s = data?.summary;
  const d = data?.deltas;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Operations · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Operational Cockpit</h1>
          <p className="mt-2 text-sm text-muted">
            Occupancy and demand trends, versus the same months last year.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.months}
              type="button"
              onClick={() => setMonths(p.months)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs transition-[background-color,color,border-color] duration-300',
                months === p.months ? 'border-forest bg-forest text-cream' : 'border-line bg-paper text-char hover:border-ink',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <div className="flex h-60 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError || !data || !s || !d ? (
        <EmptyState
          title="Couldn’t load the cockpit"
          description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <OpsMetric label="Occupancy" value={`${s.occupancy_pct}%`} delta={d.occupancy_pts} unit="pts"
              sub={`${s.room_nights_booked.toLocaleString('en')} of ${s.room_nights_available.toLocaleString('en')} nights`} />
            <OpsMetric label="Reservations" value={s.reservations.toLocaleString('en')} delta={d.reservations_pct} unit="pct"
              sub="stays in the window" />
            <OpsMetric label="ADR" value={compactPula(s.adr)} delta={d.adr_pct} unit="pct"
              sub="avg nightly rate (paid)" />
            <OpsMetric label="RevPAR" value={compactPula(s.revpar)} delta={d.revpar_pct} unit="pct"
              sub="revenue per available room" />
          </div>

          <section className="rounded-lg border border-line bg-paper p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl text-ink">Occupancy trend</h2>
              <span className="text-xs text-muted">{data.window.from} → {data.window.to} · completed months</span>
            </div>
            {data.monthly.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">No data in this period.</p>
            ) : (
              <OccupancyChart data={data.monthly} />
            )}
          </section>

          <section>
            <h2 className="mb-3 font-display text-xl text-ink">By property</h2>
            <div className="overflow-hidden rounded-lg border border-line bg-paper">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                    <th className="px-4 py-3.5 font-medium">Property</th>
                    <th className="px-4 py-3.5 text-right font-medium">Occupancy</th>
                    <th className="px-4 py-3.5 text-right font-medium">Nights booked</th>
                    <th className="px-4 py-3.5 text-right font-medium">Reservations</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_property.map((p: OpsPropertyRow) => (
                    <tr key={p.property_id ?? 'company'} className="border-b border-line last:border-0 hover:bg-cream-2">
                      <td className="px-4 py-3.5 font-display text-lg text-ink">{p.property_name}</td>
                      <td className="px-4 py-3.5 text-right tabnum text-ink">{p.occupancy_pct === null ? '—' : `${p.occupancy_pct}%`}</td>
                      <td className="px-4 py-3.5 text-right tabnum text-muted">{p.room_nights_booked.toLocaleString('en')}</td>
                      <td className="px-4 py-3.5 text-right tabnum text-muted">{p.reservations.toLocaleString('en')}</td>
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
