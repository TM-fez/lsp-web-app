import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CockpitUnit } from '@/types';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { isAssignable } from './status';
import {
  summarize,
  countForFilter,
  matchesFilter,
  matchesQuery,
  groupUnits,
  propertiesInBoard,
  matchesProperty,
  type UnitFilter,
} from './board';

const FILTERS: { key: UnitFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'AVAILABLE', label: 'Available' },
  { key: 'OCCUPIED', label: 'Occupied' },
  { key: 'NEEDS_CLEANING', label: 'Needs cleaning' },
  { key: 'MAINTENANCE', label: 'Repair' },
  { key: 'OUT_OF_SERVICE', label: 'Out of service' },
];

function cellClass(u: CockpitUnit): string {
  switch (u.status) {
    case 'OCCUPIED':
      return 'bg-ink text-cream border-ink hover:bg-char';
    case 'MAINTENANCE':
      return 'bg-paper text-terra border-terra';
    case 'OUT_OF_SERVICE':
      return 'bg-cream-2 text-faint border-line';
    default:
      return 'bg-paper text-ink border-line hover:border-ink';
  }
}

export function UnitBoard({ units, onAssign }: { units: CockpitUnit[]; onAssign: (unit: CockpitUnit) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<UnitFilter>('ALL');
  const [propertyId, setPropertyId] = useState<string | 'ALL'>('ALL');

  const properties = useMemo(() => propertiesInBoard(units), [units]);
  // Status counts + grid reflect the chosen property, so the numbers stay honest.
  const scoped = useMemo(() => units.filter((u) => matchesProperty(u, propertyId)), [units, propertyId]);
  const summary = useMemo(() => summarize(scoped), [scoped]);
  const filtered = useMemo(
    () => scoped.filter((u) => matchesFilter(u, filter) && matchesQuery(u, query)),
    [scoped, filter, query],
  );
  const groups = useMemo(() => groupUnits(filtered), [filtered]);

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <h2 className="font-display text-3xl text-ink">
          The <em className="italic text-terra">board</em>
        </h2>
        <div className="flex items-center gap-3">
          <span className="font-display text-sm italic text-muted">( {summary.total} units, live )</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              placeholder="Search unit or guest"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-52 pl-8"
            />
          </div>
        </div>
      </div>

      {properties.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted">Property</span>
          {[{ id: 'ALL' as const, name: 'All' }, ...properties].map((p) => {
            const active = propertyId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPropertyId(p.id)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-xs transition-[background-color,color,border-color] duration-300',
                  active ? 'border-ink bg-ink text-cream' : 'border-line bg-paper text-char hover:border-ink',
                )}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = countForFilter(summary, f.key);
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs transition-[background-color,color,border-color] duration-300',
                active
                  ? 'border-forest bg-forest text-cream'
                  : 'border-line bg-paper text-char hover:border-ink',
              )}
            >
              {f.label}
              <span className={cn('font-display text-[11px] italic', active ? 'text-oncream' : 'text-terra')}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No units match this view.</p>
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="mb-3 flex items-baseline gap-3">
                <span className="text-[11px] uppercase tracking-[0.22em] text-muted">{g.label}</span>
                <span className="h-px flex-1 bg-line" />
                <span className="font-display text-sm italic text-faint">{g.units.length}</span>
              </div>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 md:grid-cols-10 xl:grid-cols-12">
                {g.units.map((u) => {
                  const assignable = isAssignable(u.status, u.housekeeping_status);
                  const needsClean = u.housekeeping_status !== 'READY' && u.status !== 'OCCUPIED';
                  return (
                    <button
                      key={u.room_id}
                      type="button"
                      onClick={assignable ? () => onAssign(u) : undefined}
                      title={`${u.code} · ${u.name}${u.guest_name ? ` · ${u.guest_name}` : ''} · ${u.status.toLowerCase().replace('_', ' ')}`}
                      className={cn(
                        'relative flex aspect-square items-center justify-center rounded-md border text-xs tabnum transition-transform duration-300 ease-[cubic-bezier(.19,1,.22,1)] hover:z-10 hover:scale-[1.12]',
                        cellClass(u),
                        assignable ? 'cursor-pointer' : 'cursor-default',
                      )}
                    >
                      {u.code}
                      {needsClean && (
                        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-terra" />
                      )}
                      {u.status === 'MAINTENANCE' && (
                        <span className="pointer-events-none absolute left-[-10%] top-1/2 h-px w-[120%] -rotate-45 bg-terra/70" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-6 text-[10px] uppercase tracking-[0.18em] text-muted">
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 border border-line" />Available</span>
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 bg-ink" />Occupied</span>
        <span className="flex items-center gap-2"><i className="relative h-2.5 w-2.5 border border-line"><span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-terra" /></i>Cleaning</span>
        <span className="flex items-center gap-2"><i className="h-2.5 w-2.5 border border-terra" />Repair</span>
      </div>
    </section>
  );
}
