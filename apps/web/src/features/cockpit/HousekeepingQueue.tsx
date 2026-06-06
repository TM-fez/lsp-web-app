import type { HousekeepingQueueItem, HousekeepingTaskStatus } from '@/types';
import type { HousekeepingAction } from '@/lib/api/housekeeping';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { housekeepingTone, taskActionLabel } from './status';
import { useHousekeepingTransition } from './hooks';

const nextAction: Record<Exclude<HousekeepingTaskStatus, 'DONE'>, HousekeepingAction> = {
  OPEN: 'start',
  CLEANING: 'inspect',
  INSPECTED: 'ready',
};

export function HousekeepingQueue({ items }: { items: HousekeepingQueueItem[] }) {
  const m = useHousekeepingTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Cleaning queue <span className="text-slate-400">({items.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {items.length === 0 && <p className="text-sm text-slate-400">Every unit is ready. ✨</p>}
        {items.map((item) => {
          const label = taskActionLabel[item.task_status];
          const action = item.task_status === 'DONE' ? null : nextAction[item.task_status];
          return (
            <div
              key={item.task_id}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">
                  {item.room_code} · {item.room_name}
                </div>
                <div className="text-xs text-slate-500">opened {item.opened_at.slice(5, 16).replace('T', ' ')}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={housekeepingTone[item.housekeeping_status]}>
                  {item.housekeeping_status.toLowerCase()}
                </Badge>
                {action && label && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={m.isPending}
                    onClick={() => m.mutate({ roomId: item.room_id, action })}
                  >
                    {label}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
