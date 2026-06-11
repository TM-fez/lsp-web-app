import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { CockpitUnit } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { UnitTile } from './UnitTile';
import {
  summarize,
  countForFilter,
  matchesFilter,
  matchesQuery,
  groupUnits,
  type UnitFilter,
} from './board';

const FILTERS: { key: UnitFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'AVAILABLE', label: 'Available' },
  { key: 'OCCUPIED', label: 'Occupied' },
  { key: 'NEEDS_CLEANING', label: 'Needs cleaning' },
  { key: 'MAINTENANCE', label: 'Maintenance' },
  { key: 'OUT_OF_SERVICE', label: 'Out of service' },
];

export function UnitBoard({ units, onAssign }: { units: CockpitUnit[]; onAssign: (unit: CockpitUnit) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<UnitFilter>('ALL');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const summary = useMemo(() => summarize(units), [units]);
  const filtered = useMemo(
    () => units.filter((u) => matchesFilter(u, filter) && matchesQuery(u, query)),
    [units, filter, query],
  );
  const groups = useMemo(() => groupUnits(filtered), [filtered]);

  function toggle(label: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>
            Units <span className="ml-1 text-sm font-normal text-slate-400">{summary.total}</span>
          </CardTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search unit or guest"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-56 pl-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count = countForFilter(summary, f.key);
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                )}
              >
                {f.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[11px]',
                    active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No units match this view.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.label);
              return (
                <div key={g.label}>
                  <button
                    type="button"
                    onClick={() => toggle(g.label)}
                    className="mb-2 flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {g.label}
                    <span className="font-normal text-slate-400">{g.units.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                      {g.units.map((u) => (
                        <UnitTile key={u.room_id} unit={u} onAssign={onAssign} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
