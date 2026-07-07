import { useMemo, useState } from 'react';
import { ChevronDown, Printer, HandCoins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { cn } from '@/lib/utils/cn';
import { useOwners } from './hooks';
import type { OwnerStatement } from '@/types';

// ── month → window helpers ─────────────────────────────────────────────────────
function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
function windowForMonth(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate(); // day 0 of next month = last of this
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}
function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
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
  const p = thebe / 100;
  const sign = p < 0 ? '-' : '';
  return `${sign}P${Math.abs(p).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function OwnerCard({ owner, from, to }: { owner: OwnerStatement; from: string; to: string }) {
  const [open, setOpen] = useState(false);
  const openStatement = () =>
    window.open(`/owners/print?from=${from}&to=${to}&landlord=${encodeURIComponent(owner.landlord_name)}`, '_blank');

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-paper">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-[220px] flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
          <div>
            <div className="font-display text-xl text-ink">{owner.landlord_name}</div>
            <div className="text-xs text-muted">
              {owner.unit_count} unit{owner.unit_count === 1 ? '' : 's'} · {owner.occupancy_pct}% occupancy
            </div>
          </div>
        </button>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Revenue</div>
            <div className="tabnum text-ink" title={fullPula(owner.revenue)}>{compactPula(owner.revenue)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Costs</div>
            <div className="tabnum text-muted" title={fullPula(owner.maintenance_cost)}>{compactPula(owner.maintenance_cost)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Net payout</div>
            <div className={cn('tabnum font-medium', owner.net >= 0 ? 'text-forest' : 'text-terra')} title={fullPula(owner.net)}>
              {compactPula(owner.net)}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={openStatement}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />Statement
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-cream-2/40 px-4 py-3">
          {owner.landlord_phone && (
            <div className="mb-3">
              <WhatsAppButton phone={owner.landlord_phone} label={`WhatsApp ${owner.landlord_phone}`} />
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.14em] text-muted">
                <th className="py-2 pr-4 font-medium">Unit</th>
                <th className="py-2 pr-4 font-medium">Property</th>
                <th className="py-2 pr-4 text-right font-medium">Revenue</th>
                <th className="py-2 pr-4 text-right font-medium">Nights</th>
                <th className="py-2 pr-4 text-right font-medium">Occ.</th>
                <th className="py-2 pr-4 text-right font-medium">Costs</th>
                <th className="py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {owner.units.map((u) => (
                <tr key={u.room_id} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-4 text-ink">{u.room_code ?? u.room_name}</td>
                  <td className="py-2 pr-4 text-muted">{u.property_name}</td>
                  <td className="py-2 pr-4 text-right tabnum text-ink" title={fullPula(u.revenue)}>{compactPula(u.revenue)}</td>
                  <td className="py-2 pr-4 text-right tabnum text-muted">{u.nights}</td>
                  <td className="py-2 pr-4 text-right tabnum text-muted">{u.occupancy_pct}%</td>
                  <td className="py-2 pr-4 text-right tabnum text-muted" title={fullPula(u.maintenance_cost)}>{compactPula(u.maintenance_cost)}</td>
                  <td className={cn('py-2 text-right tabnum', u.net >= 0 ? 'text-forest' : 'text-terra')} title={fullPula(u.net)}>{compactPula(u.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function OwnerStatementsPage() {
  const [month, setMonth] = useState<string>(currentMonth());
  const { from, to } = useMemo(() => windowForMonth(month), [month]);
  const { data, isLoading, isError, refetch } = useOwners({ from, to });
  const t = data?.totals;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Finance · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Owner statements</h1>
          <p className="mt-2 text-sm text-muted">Monthly payouts for units we manage on behalf of landlords.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted">Month</span>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} className="h-9 w-44" />
        </div>
      </header>

      {isLoading ? (
        <div className="flex h-60 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError || !data || !t ? (
        <EmptyState
          title="Couldn’t load owner statements"
          description="The server didn’t respond. Try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : data.owners.length === 0 ? (
        <EmptyState
          icon={<HandCoins className="h-6 w-6" />}
          title="No landlord units in scope"
          description={`No units marked as landlord-owned for ${monthTitle(month)}. Set a room’s ownership to “Landlord” to start tracking a payout.`}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label="Landlords" value={String(t.landlords)} sub={`${t.units} unit${t.units === 1 ? '' : 's'}`} />
            <Metric label="Revenue" value={compactPula(t.revenue)} sub={fullPula(t.revenue)} />
            <Metric label="Owner-charged costs" value={compactPula(t.maintenance_cost)} sub="approved repairs" />
            <Metric label="Net payout" value={compactPula(t.net)} sub={`${monthTitle(month)}`} tone={t.net >= 0 ? 'pos' : 'neg'} />
          </div>

          <section className="flex flex-col gap-3">
            {data.owners.map((o) => (
              <OwnerCard key={o.landlord_name} owner={o} from={from} to={to} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
