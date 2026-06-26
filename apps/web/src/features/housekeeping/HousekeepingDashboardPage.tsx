import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/store/auth';
import { useRooms } from '@/features/rooms/hooks';
import { housekeepingTone } from '@/features/cockpit/status';
import { useTurn } from './hooks';
import { nextAction, actionLabel, hkLabel } from './util';
import type { HousekeepingStatus, Room } from '@/types';

// The four housekeeping states as KPI tiles, in workflow order (dirty → ready).
const STATS: { key: HousekeepingStatus; label: string; hint: string }[] = [
  { key: 'DIRTY', label: 'To clean', hint: 'Awaiting a cleaner' },
  { key: 'CLEANING', label: 'In progress', hint: 'Being cleaned now' },
  { key: 'INSPECTED', label: 'Awaiting sign-off', hint: 'Cleaned, needs a check' },
  { key: 'READY', label: 'Ready', hint: 'Good to sell' },
];

// Number colour per state, matching the Badge tones (see cockpit/status).
const toneText: Record<string, string> = {
  rose: 'text-rose-700',
  amber: 'text-amber-700',
  blue: 'text-blue-700',
  green: 'text-emerald-700',
};

// Hardest-first ordering for the action list; READY units are excluded entirely.
const ATTENTION_ORDER: HousekeepingStatus[] = ['DIRTY', 'CLEANING', 'INSPECTED'];
const TOP = 8;

export function HousekeepingDashboardPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canUpdate = hasPerm('housekeeping.update');
  const { data: rooms, isLoading, isError, refetch } = useRooms();
  const turn = useTurn();

  const counts = useMemo(() => {
    const c: Record<HousekeepingStatus, number> = { DIRTY: 0, CLEANING: 0, INSPECTED: 0, READY: 0 };
    (rooms ?? []).forEach((r) => {
      c[r.housekeeping_status] += 1;
    });
    return c;
  }, [rooms]);

  const total = rooms?.length ?? 0;
  const needsAttention = counts.DIRTY + counts.CLEANING + counts.INSPECTED;

  // Every unit that isn't READY, hardest-first then by code — the actionable queue.
  const attention = useMemo(
    () =>
      (rooms ?? [])
        .filter((r) => r.housekeeping_status !== 'READY')
        .sort(
          (a, b) =>
            ATTENTION_ORDER.indexOf(a.housekeeping_status) - ATTENTION_ORDER.indexOf(b.housekeeping_status) ||
            a.code.localeCompare(b.code),
        ),
    [rooms],
  );
  const shown = attention.slice(0, TOP);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-ink">Housekeeping</h1>
          <p className="text-sm text-slate-500">
            {isLoading
              ? 'Loading the board…'
              : needsAttention === 0
                ? `All ${total} units are ready ✨`
                : `${needsAttention} of ${total} units need attention`}
          </p>
        </div>
        <Link to="/housekeeping/all" className={buttonVariants({ variant: 'outline' })}>
          View full queue
        </Link>
      </div>

      {isError ? (
        <EmptyState
          title="Couldn’t load housekeeping"
          description="The server didn’t respond. Check the API is running and try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.key} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-slate-400">{s.label}</div>
                <div className={cn('mt-1 text-3xl font-semibold', toneText[housekeepingTone[s.key]])}>
                  {counts[s.key]}
                </div>
                <div className="mt-1 text-xs text-slate-500">{s.hint}</div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-medium text-slate-700">Needs attention now</h2>
              {attention.length > TOP && (
                <Link
                  to="/housekeeping/all"
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                >
                  View all {attention.length}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>

            {shown.length === 0 ? (
              <div className="px-4 py-10">
                <EmptyState
                  icon={<Sparkles className="h-8 w-8" />}
                  title="Every unit is ready ✨"
                  description="Nothing in the cleaning queue right now. New checkouts appear here automatically."
                />
              </div>
            ) : (
              <ul>
                {shown.map((room: Room) => {
                  const action = nextAction[room.housekeeping_status];
                  const pending = turn.isPending && turn.variables?.roomId === room.id;
                  return (
                    <li
                      key={room.id}
                      className="flex items-center justify-between border-b border-slate-50 px-4 py-3 last:border-0 hover:bg-slate-50/60"
                    >
                      <div>
                        <div className="font-medium text-slate-900">{room.code}</div>
                        <div className="text-xs text-slate-500">{room.name}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge tone={housekeepingTone[room.housekeeping_status]}>
                          {hkLabel(room.housekeeping_status)}
                        </Badge>
                        {pending && <Spinner className="h-4 w-4 text-slate-400" />}
                        {action && canUpdate && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => turn.mutate({ roomId: room.id, action })}
                          >
                            {actionLabel[action]}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
