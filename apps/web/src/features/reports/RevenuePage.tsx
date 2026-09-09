import { useState } from 'react';
import { Download, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { todayISO } from '@/lib/utils/date';
import { useRevenue } from './hooks';
import { AccrualWarnings } from './AccrualWarnings';
import { downloadRevenueCsv } from './csv';
import type { EarnedReceivedPoint } from '@/types';

// ── palette (matches the editorial theme tokens, same as ReportsPage) ─────────
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

/**
 * Earned vs received, grouped bars per month (bespoke SVG, no chart lib — same
 * approach as the P&L chart beside it).
 *
 * Both series share one scale on purpose. The gap between the two bars in a month is
 * the number this page exists to show, and two axes would make an arbitrary gap look
 * like a real one.
 */
function EarnedReceivedChart({ data }: { data: EarnedReceivedPoint[] }) {
  const W = 760, H = 240, padL = 46, padR = 10, padT = 14, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(1, ...data.map((d) => Math.max(d.earned, d.received)));
  const groupW = innerW / data.length;
  const barW = Math.min(13, groupW / 3.2);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const gridVals = [0, max / 2, max];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
      aria-label="Revenue earned versus payments received, month by month across the selected period.">
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={LINE} strokeWidth={1} />
          <text x={padL - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill={MUTED}>{compactPula(v)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const gx = padL + i * groupW + groupW / 2;
        return (
          <g key={d.month}>
            <rect x={gx - barW - 1.5} y={y(d.earned)} width={barW} height={Math.max(0, y(0) - y(d.earned))} fill={FOREST} rx={1.5}>
              <title>{`${d.month} earned ${fullPula(d.earned)}`}</title>
            </rect>
            <rect x={gx + 1.5} y={y(d.received)} width={barW} height={Math.max(0, y(0) - y(d.received))} fill={TERRA} rx={1.5}>
              <title>{`${d.month} received ${fullPula(d.received)}`}</title>
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

/**
 * G30 — the reconciliation the accrual switch made necessary.
 *
 * Before the revenue ledger this page could not exist: "earned" and "received" were
 * the same number, read off the same invoices. Now a guest who stays in September and
 * settles in October earns in September and pays in October, and the running gap
 * between the columns is what the house is owed for nights it has already provided.
 *
 * The sign matters and is labelled rather than left to the reader: positive means
 * earned-not-yet-collected (a receivable), negative means collected in advance of the
 * stay (a deposit on nights not yet slept in). Both are normal; conflating them is not.
 */
export function RevenuePage() {
  const [months, setMonths] = useState<number>(12);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const useCustom = !!(customFrom && customTo && customFrom <= customTo);
  const preset = windowFor(months);
  const from = useCustom ? customFrom : preset.from;
  const to = useCustom ? customTo : preset.to;

  const { data, isLoading, isError, refetch } = useRevenue({ from, to });
  const t = data?.totals;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Finance · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Earned vs received</h1>
          <p className="mt-2 text-sm text-muted">
            Revenue earned from nights provided, against the money that actually landed.
          </p>
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

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] uppercase tracking-[0.18em] text-muted">Custom range</span>
        <Input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-40" />
        <span className="text-muted">→</span>
        <Input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-40" />
        {useCustom && (
          <button type="button" onClick={() => { setCustomFrom(''); setCustomTo(''); }} className="text-xs text-terra hover:underline">Clear</button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" disabled={!data} onClick={() => data && downloadRevenueCsv(data, from, to)}>
            <Download className="mr-1.5 h-3.5 w-3.5" />Export CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-60 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError || !data || !t ? (
        <EmptyState
          title="Couldn’t load the revenue reconciliation"
          description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : data.monthly.length === 0 ? (
        <EmptyState
          icon={<Scale className="h-8 w-8" />}
          title="No months in this range"
          description="Pick a wider period, or clear the custom range, to see revenue earned against payments received."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Earned" value={compactPula(t.earned)} sub={fullPula(t.earned)} />
            <Metric label="Received" value={compactPula(t.received)} sub={fullPula(t.received)} />
            <Metric
              label={t.difference >= 0 ? 'Still owed' : 'Paid in advance'}
              value={compactPula(Math.abs(t.difference))}
              sub={t.difference >= 0 ? 'earned, not yet collected' : 'collected, nights not yet slept'}
              tone={t.difference >= 0 ? 'neg' : 'pos'}
            />
            <Metric label="VAT in earned" value={compactPula(t.earned_tax)} sub="accrual counterpart of output VAT" />
          </div>

          <div className="flex flex-col gap-2 text-xs text-muted">
            <p>
              <strong className="font-medium text-char">Earned</strong> counts a night in the month it was
              slept in, whenever the guest pays. <strong className="font-medium text-char">Received</strong>{' '}
              counts a payment in the month it landed. The gap between them is the point: it is what the
              house is owed for nights it has already provided.
            </p>
            <AccrualWarnings disclosure={data.disclosure} />
          </div>

          <section className="rounded-lg border border-line bg-paper p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-xl text-ink">Month by month</h2>
              <div className="flex items-center gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: FOREST }} /> Earned</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: TERRA }} /> Received</span>
              </div>
            </div>
            <EarnedReceivedChart data={data.monthly} />
          </section>

          <section>
            <h2 className="mb-3 font-display text-xl text-ink">The reconciliation</h2>
            <div className="overflow-hidden rounded-lg border border-line bg-paper">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                    <th className="px-4 py-3.5 font-medium">Month</th>
                    <th className="px-4 py-3.5 text-right font-medium">Earned</th>
                    <th className="px-4 py-3.5 text-right font-medium">Received</th>
                    <th className="px-4 py-3.5 text-right font-medium">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((m) => (
                    <tr key={m.month} className="border-b border-line last:border-0 hover:bg-cream-2">
                      <td className="px-4 py-3.5 tabnum text-ink">{m.month}</td>
                      <td className="px-4 py-3.5 text-right tabnum text-ink" title={fullPula(m.earned)}>{compactPula(m.earned)}</td>
                      <td className="px-4 py-3.5 text-right tabnum text-muted" title={fullPula(m.received)}>{compactPula(m.received)}</td>
                      <td
                        className={cn('px-4 py-3.5 text-right tabnum', m.difference > 0 ? 'text-terra' : m.difference < 0 ? 'text-forest' : 'text-muted')}
                        title={fullPula(m.difference)}
                      >
                        {compactPula(m.difference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line bg-cream-2 text-sm">
                    <td className="px-4 py-3.5 font-display text-lg text-ink">Total</td>
                    <td className="px-4 py-3.5 text-right tabnum text-ink" title={fullPula(t.earned)}>{compactPula(t.earned)}</td>
                    <td className="px-4 py-3.5 text-right tabnum text-ink" title={fullPula(t.received)}>{compactPula(t.received)}</td>
                    <td
                      className={cn('px-4 py-3.5 text-right tabnum', t.difference > 0 ? 'text-terra' : t.difference < 0 ? 'text-forest' : 'text-muted')}
                      title={fullPula(t.difference)}
                    >
                      {compactPula(t.difference)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
