import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useCreateRoom, useUpdateRoom, useDeleteRoom } from './hooks';
import type { Room, RoomCreateStatus, UnitType } from '@/types';

const UNIT_TYPES: UnitType[] = ['STANDARD', 'DELUXE', 'SUITE', 'CONFERENCE', 'CUSTOM'];
const CREATE_STATUSES: RoomCreateStatus[] = ['AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room?: Room | null;
  canDelete?: boolean;
}

export function RoomFormDrawer({ open, onOpenChange, room, canDelete }: Props) {
  const isEdit = !!room;
  const create = useCreateRoom();
  const update = useUpdateRoom();
  const remove = useDeleteRoom();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<UnitType>('STANDARD');
  const [status, setStatus] = useState<RoomCreateStatus>('AVAILABLE');
  const [capacity, setCapacity] = useState(2);
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(room?.name ?? '');
    setCode(room?.code ?? '');
    setType(room?.type ?? 'STANDARD');
    setStatus('AVAILABLE');
    setCapacity(room?.capacity ?? 2);
    setNotes(room?.notes ?? '');
    setConfirmDelete(false);
  }, [open, room]);

  const valid = name.trim().length > 0 && code.trim().length > 0 && capacity >= 1;

  async function submit() {
    if (!valid) return;
    try {
      if (room) {
        await update.mutateAsync({
          id: room.id,
          input: { name: name.trim(), code: code.trim(), type, capacity, notes: notes.trim() || null },
        });
      } else {
        await create.mutateAsync({
          name: name.trim(),
          code: code.trim(),
          type,
          status,
          capacity,
          notes: notes.trim() || null,
        });
      }
      onOpenChange(false);
    } catch {
      /* hook surfaces the error toast; keep the drawer open */
    }
  }

  async function doDelete() {
    if (!room) return;
    try {
      await remove.mutateAsync(room.id);
      onOpenChange(false);
    } catch {
      /* toast shown by hook */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${room?.code}` : 'Add a unit'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update unit details. Availability is changed from the unit row, not here.'
              : 'Create a unit so it can be priced, booked and cleaned.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="room-code">Code</Label>
              <Input id="room-code" placeholder="e.g. 101" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="room-cap">Capacity</Label>
              <Input
                id="room-cap"
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="room-name">Name</Label>
            <Input
              id="room-name"
              placeholder="e.g. Garden Suite"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="room-type">Type</Label>
              <Select id="room-type" value={type} onChange={(e) => setType(e.target.value as UnitType)}>
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
            {!isEdit && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="room-status">Initial status</Label>
                <Select id="room-status" value={status} onChange={(e) => setStatus(e.target.value as RoomCreateStatus)}>
                  {CREATE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, ' ').toLowerCase()}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="room-notes">Notes (optional)</Label>
            <textarea
              id="room-notes"
              rows={3}
              placeholder="Anything staff should know about this unit"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            />
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !valid}>
              {busy && <Spinner className="text-white" />} {isEdit ? 'Save changes' : 'Create unit'}
            </Button>
          </div>

          {isEdit && canDelete && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label className="text-rose-600">Danger zone</Label>
              {!confirmDelete ? (
                <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Remove this unit
                </Button>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
                  <span className="text-sm text-rose-700">Remove {room?.code}? This hides it from operations.</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                      Keep
                    </Button>
                    <Button variant="danger" onClick={doDelete} disabled={busy}>
                      {busy && <Spinner className="text-white" />} Remove
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
