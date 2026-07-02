import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { useAuthStore } from '@/store/auth';
import { useRooms } from '@/features/rooms/hooks';
import { useTurn } from './hooks';
import { ChecklistDialog } from './ChecklistDialog';
import { nextAction, actionLabel, canDoAction } from './util';
import { useState } from 'react';
import type { HousekeepingStatus, Room } from '@/types';

/**
 * The tablet board (Phase 3, A3): a chrome-less, full-screen live view of every
 * unit's readiness, grouped by stage, with touch-sized action buttons. Meant to
 * be pinned on a housekeeping tablet — it polls so the wall always shows the
 * current state without anyone refreshing.
 */

const POLL_MS = 20_000;

const COLUMNS: { status: HousekeepingStatus; title: string; accent: string; chip: string }[] = [
  { status: 'DIRTY', title: 'To clean', accent: 'border-rose-300 bg-rose-50', chip: 'bg-rose-100 text-rose-700' },
  { status: 'CLEANING', title: 'Cleaning', accent: 'border-amber-300 bg-amber-50', chip: 'bg-amber-100 text-amber-700' },
  { status: 'INSPECTED', title: 'Awaiting sign-off', accent: 'border-blue-300 bg-blue-50', chip: 'bg-blue-100 text-blue-700' },
  { status: 'READY', title: 'Ready', accent: 'border-emerald-300 bg-emerald-50', chip: 'bg-emerald-100 text-emerald-700' },
];

export function HousekeepingBoardPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const { data: rooms, isLoading, dataUpdatedAt } = useRooms({ refetchInterval: POLL_MS });
  const turn = useTurn();
  const [checklistRoom, setChecklistRoom] = useState<Room | null>(null);

  const byStatus = useMemo(() => {
    const groups: Record<HousekeepingStatus, Room[]> = { DIRTY: [], CLEANING: [], INSPECTED: [], READY: [] };
    for (const room of rooms ?? []) groups[room.housekeeping_status]?.push(room);
    for (const list of Object.values(groups)) list.sort((a, b) => a.code.localeCompare(b.code));
    return groups;
  }, [rooms]);

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl text-ink">Housekeeping board</h1>
          <p className="text-xs text-slate-500">
            Live — refreshes every {POLL_MS / 1000}s
            {dataUpdatedAt ? ` · updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <Link to="/housekeeping" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          Exit board
        </Link>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const units = byStatus[col.status];
            return (
              <section key={col.status} className={cn('rounded-xl border-2 p-3', col.accent)}>
                <header className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{col.title}</h2>
                  <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-semibold', col.chip)}>
                    {units.length}
                  </span>
                </header>
                <div className="flex flex-col gap-2">
                  {units.length === 0 ? (
                    <p className="px-1 pb-2 text-sm text-slate-400">None</p>
                  ) : (
                    units.map((room) => {
                      const action = nextAction[room.housekeeping_status];
                      const allowed = action != null && canDoAction(action, hasPerm);
                      const pending = turn.isPending && turn.variables?.roomId === room.id;
                      return (
                        <div key={room.id} className="rounded-lg border border-white/80 bg-white p-3 shadow-sm">
                          <div className="flex items-baseline justify-between">
                            <span className="font-display text-2xl text-ink">{room.code}</span>
                            <span className="max-w-[10rem] truncate text-xs text-slate-400">{room.name}</span>
                          </div>
                          {(allowed || room.housekeeping_status === 'CLEANING') && (
                            <div className="mt-2 flex gap-2">
                              {room.housekeeping_status === 'CLEANING' && (
                                <button
                                  type="button"
                                  onClick={() => setChecklistRoom(room)}
                                  className="min-h-11 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 active:bg-slate-100"
                                >
                                  Checklist
                                </button>
                              )}
                              {allowed && (
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => turn.mutate({ roomId: room.id, action: action! })}
                                  className="min-h-11 flex-1 rounded-md bg-slate-900 px-3 text-sm font-medium text-white active:bg-slate-700 disabled:opacity-50"
                                >
                                  {pending ? '…' : actionLabel[action!]}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ChecklistDialog room={checklistRoom} onClose={() => setChecklistRoom(null)} />
    </div>
  );
}
