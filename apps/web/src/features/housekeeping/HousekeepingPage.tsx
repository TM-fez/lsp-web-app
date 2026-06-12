import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/store/auth';
import { useRooms } from '@/features/rooms/hooks';
import { housekeepingTone, roomStatusTone } from '@/features/cockpit/status';
import { useTurn } from './hooks';
import { nextAction, actionLabel, hkLabel } from './util';
import type { HousekeepingStatus, Room } from '@/types';

const roomLabel = (s: string) => s.replace(/_/g, ' ').toLowerCase();

export function HousekeepingPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canUpdate = hasPerm('housekeeping.update');

  const { data: rooms, isLoading, isError, refetch } = useRooms();
  const turn = useTurn();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | HousekeepingStatus>('ALL');

  const counts = useMemo(() => {
    const c: Record<HousekeepingStatus, number> = { DIRTY: 0, CLEANING: 0, INSPECTED: 0, READY: 0 };
    (rooms ?? []).forEach((r) => {
      c[r.housekeeping_status] += 1;
    });
    return c;
  }, [rooms]);
  const needsAttention = counts.DIRTY + counts.CLEANING + counts.INSPECTED;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rooms ?? []).filter((r) => {
      if (statusFilter !== 'ALL' && r.housekeeping_status !== statusFilter) return false;
      if (!q) return true;
      return r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
    });
  }, [rooms, search, statusFilter]);

  const chips: { key: 'ALL' | HousekeepingStatus; label: string; count: number }[] = [
    { key: 'ALL', label: 'All units', count: rooms?.length ?? 0 },
    { key: 'DIRTY', label: 'Dirty', count: counts.DIRTY },
    { key: 'CLEANING', label: 'Cleaning', count: counts.CLEANING },
    { key: 'INSPECTED', label: 'Inspected', count: counts.INSPECTED },
    { key: 'READY', label: 'Ready', count: counts.READY },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-4xl text-ink">Housekeeping</h1>
        <p className="text-sm text-slate-500">
          {!rooms
            ? 'Track every unit from dirty to ready'
            : needsAttention === 0
              ? 'Every unit is ready ✨'
              : `${needsAttention} unit${needsAttention === 1 ? ' needs' : 's need'} attention`}
        </p>
      </div>

      {!isLoading && !isError && (rooms?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => {
              const active = statusFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setStatusFilter(chip.key)}
                  className={cn(
                    'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {chip.label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11px]',
                      active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {chip.count}
                  </span>
                </button>
              );
            })}
          </div>
          <Input
            placeholder="Search unit code or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load housekeeping"
          description="The server didn’t respond. Check the API is running and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : (rooms?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-8 w-8" />}
          title="No units to clean yet"
          description="Add units under Admin → Rooms first. Every checkout then queues its unit here for the clean → inspect → ready turn."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing here" description="No units match this filter or search. Try clearing them." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">Unit</th>
                <th className="px-4 py-3 font-medium">Unit status</th>
                <th className="px-4 py-3 font-medium">Housekeeping</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((room: Room) => {
                const action = nextAction[room.housekeeping_status];
                const pending = turn.isPending && turn.variables?.roomId === room.id;
                return (
                  <tr key={room.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{room.code}</div>
                      <div className="text-xs text-slate-500">{room.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={roomStatusTone[room.status]}>{roomLabel(room.status)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={housekeepingTone[room.housekeeping_status]}>
                        {hkLabel(room.housekeeping_status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {pending && <Spinner className="h-4 w-4 text-slate-400" />}
                        {action == null ? (
                          <span className="text-xs text-emerald-600">Ready ✨</span>
                        ) : canUpdate ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => turn.mutate({ roomId: room.id, action })}
                          >
                            {actionLabel[action]}
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">View only</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
