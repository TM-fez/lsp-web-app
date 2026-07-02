import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { useRoomChecks, useSetRoomCheck, useChecklist, useAddChecklistItem, useUpdateChecklistItem } from './hooks';
import type { Room } from '@/types';

/**
 * The cleaner's compliance checklist for one unit's live turn. Ticks save
 * immediately; supervisor validation (inspect) is blocked server-side until
 * every item is ticked.
 */
export function ChecklistDialog({ room, onClose }: { room: Room | null; onClose: () => void }) {
  const { data, isLoading } = useRoomChecks(room?.id ?? null);
  const setCheck = useSetRoomCheck();

  const items = data?.items ?? [];
  const done = items.filter((i) => i.checked).length;
  const cleaning = data?.task_status === 'CLEANING';

  return (
    <Dialog open={!!room} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cleaning checklist — {room?.code}</DialogTitle>
          <DialogDescription>
            {items.length > 0
              ? `${done} of ${items.length} done. Every item must be ticked before the clean can be validated.`
              : 'The cleaning standard for every turn.'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner className="h-5 w-5" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">No checklist items configured.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-slate-50',
                    !cleaning && 'cursor-default opacity-70',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    disabled={!cleaning || setCheck.isPending}
                    onChange={(e) =>
                      room && setCheck.mutate({ roomId: room.id, itemId: item.id, checked: e.target.checked })
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className={cn(item.checked && 'text-slate-400 line-through')}>{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {!cleaning && !isLoading && (
          <p className="text-xs text-slate-500">
            Ticking is only possible while the unit is being cleaned.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Manager curation of the cleaning standard: add items, retire (deactivate) or
 * reactivate them. Gated by housekeeping.signoff at the caller + the API.
 */
export function ManageChecklistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: items, isLoading } = useChecklist(true, open);
  const add = useAddChecklistItem();
  const update = useUpdateChecklistItem();
  const [label, setLabel] = useState('');

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) return;
    add.mutate(trimmed, { onSuccess: () => setLabel('') });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cleaning standard</DialogTitle>
          <DialogDescription>
            The compliance checklist every turn must satisfy before validation. Retired items stop
            gating new turns but keep their history.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {(items ?? []).map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                <span className={cn(!item.active && 'text-slate-400 line-through')}>{item.label}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: item.id, patch: { active: !item.active } })}
                >
                  {item.active ? 'Retire' : 'Reactivate'}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <Input
            placeholder="Add an item, e.g. Balcony swept"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Button variant="primary" disabled={add.isPending || !label.trim()} onClick={submit}>
            {add.isPending && <Spinner className="text-white" />} Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
