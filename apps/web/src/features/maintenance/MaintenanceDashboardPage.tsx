import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, ArrowRight } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/store/auth';
import { useRooms } from '@/features/rooms/hooks';
import { useWorkOrders, useStartWorkOrder, useCompleteWorkOrder } from './hooks';
import { statusTone, statusLabel, priorityTone, priorityLabel, nextAction, actionLabel } from './util';
import type { MaintenanceStatus, MaintenancePriority, WorkOrder } from '@/types';

// Active = the work that still needs doing; COMPLETED/CANCELLED are done.
const ACTIVE: MaintenanceStatus[] = ['OPEN', 'IN_PROGRESS', 'BLOCKED'];
// Number colour per badge tone (matches maintenance/util tones).
const toneText: Record<string, string> = {
  slate: 'text-slate-600',
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  blue: 'text-blue-700',
  rose: 'text-rose-700',
  violet: 'text-violet-700',
};
// Worst-first ordering for the action list.
const PRIORITY_RANK: Record<MaintenancePriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const TOP = 8;

export function MaintenanceDashboardPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canUpdate = hasPerm('maintenance.update');
  // Contractors carry the narrower maintenance.work instead of maintenance.update.
  const canStart = canUpdate || hasPerm('maintenance.work');
  const canComplete = hasPerm('maintenance.complete');

  const { data: rooms } = useRooms();
  const roomCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rooms ?? []) map.set(r.id, r.code);
    return (id: string) => map.get(id) ?? '—';
  }, [rooms]);

  const { data, isLoading, isError, refetch } = useWorkOrders({});
  const start = useStartWorkOrder();
  const complete = useCompleteWorkOrder();

  const orders = data?.data ?? [];

  const counts = useMemo(() => {
    const c: Record<MaintenanceStatus, number> = { OPEN: 0, IN_PROGRESS: 0, BLOCKED: 0, COMPLETED: 0, CANCELLED: 0 };
    orders.forEach((o) => {
      c[o.status] += 1;
    });
    return c;
  }, [orders]);

  // Active work orders, worst priority first then oldest — the actionable queue.
  const active = useMemo(
    () =>
      orders
        .filter((o) => ACTIVE.includes(o.status))
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            (a.opened_at ?? '').localeCompare(b.opened_at ?? ''),
        ),
    [orders],
  );
  const critical = active.filter((o) => o.priority === 'CRITICAL').length;
  const shown = active.slice(0, TOP);

  const tiles = [
    { label: 'Open', value: counts.OPEN, tone: statusTone.OPEN, hint: 'Logged, not started' },
    { label: 'In progress', value: counts.IN_PROGRESS, tone: statusTone.IN_PROGRESS, hint: 'Being worked on' },
    { label: 'Blocked', value: counts.BLOCKED, tone: statusTone.BLOCKED, hint: 'Stuck — needs a nudge' },
    { label: 'Critical', value: critical, tone: priorityTone.CRITICAL, hint: 'Urgent, still open' },
  ];

  function runAction(o: WorkOrder) {
    const action = nextAction[o.status];
    if (action === 'start') start.mutate(o.id);
    else if (action === 'complete') complete.mutate({ id: o.id });
  }
  const canDo = (action: 'start' | 'complete') => (action === 'complete' ? canComplete : canStart);

  const headline = isLoading
    ? 'Loading the board…'
    : active.length === 0
      ? 'No open work orders ✨'
      : active.length === 1
        ? '1 work order needs attention'
        : `${active.length} work orders need attention`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-ink">Maintenance</h1>
          <p className="text-sm text-slate-500">{headline}</p>
        </div>
        <Link to="/maintenance/all" className={buttonVariants({ variant: 'outline' })}>
          View full board
        </Link>
      </div>

      {isError ? (
        <EmptyState
          title="Couldn’t load maintenance"
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
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-slate-400">{t.label}</div>
                <div className={cn('mt-1 text-3xl font-semibold', toneText[t.tone])}>{t.value}</div>
                <div className="mt-1 text-xs text-slate-500">{t.hint}</div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-medium text-slate-700">Needs attention now</h2>
              {active.length > TOP && (
                <Link
                  to="/maintenance/all"
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                >
                  View all {active.length}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>

            {shown.length === 0 ? (
              <div className="px-4 py-10">
                <EmptyState
                  icon={<Wrench className="h-8 w-8" />}
                  title="No open work orders ✨"
                  description="Nothing needs a repair right now. New work orders appear here as they’re logged."
                />
              </div>
            ) : (
              <ul>
                {shown.map((o: WorkOrder) => {
                  const action = nextAction[o.status];
                  const pending =
                    (start.isPending && start.variables === o.id) ||
                    (complete.isPending && (complete.variables as { id: string } | undefined)?.id === o.id);
                  return (
                    <li
                      key={o.id}
                      className="flex items-center justify-between border-b border-slate-50 px-4 py-3 last:border-0 hover:bg-slate-50/60"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">{o.title}</div>
                        <div className="text-xs text-slate-500">{roomCode(o.room_id)}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge tone={priorityTone[o.priority]}>{priorityLabel(o.priority)}</Badge>
                        <Badge tone={statusTone[o.status]}>{statusLabel[o.status]}</Badge>
                        {pending && <Spinner className="h-4 w-4 text-slate-400" />}
                        {action && canDo(action) && (
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => runAction(o)}>
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
