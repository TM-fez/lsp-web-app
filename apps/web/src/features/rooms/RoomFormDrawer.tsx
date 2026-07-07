import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/store/toast';
import { useCreateRoom, useUpdateRoom, useDeleteRoom, useRoom, useSetChannelConfig, useRotateIcalToken, useRotateGuestToken } from './hooks';
import { useProperties } from '@/features/properties/hooks';
import type { Room, RoomCreateStatus, RoomOwnership, UnitType } from '@/types';

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
  const [buildingId, setBuildingId] = useState('');
  const [floor, setFloor] = useState('');
  const [ownership, setOwnership] = useState<RoomOwnership>('LIFESTYLE');
  const [landlordName, setLandlordName] = useState('');
  const [landlordPhone, setLandlordPhone] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: properties } = useProperties();

  useEffect(() => {
    if (!open) return;
    setName(room?.name ?? '');
    setCode(room?.code ?? '');
    setType(room?.type ?? 'STANDARD');
    setStatus('AVAILABLE');
    setCapacity(room?.capacity ?? 2);
    setNotes(room?.notes ?? '');
    setBuildingId(room?.building_id ?? '');
    setFloor(room?.floor != null ? String(room.floor) : '');
    setOwnership(room?.ownership ?? 'LIFESTYLE');
    setLandlordName(room?.landlord_name ?? '');
    setLandlordPhone(room?.landlord_phone ?? '');
    setConfirmDelete(false);
  }, [open, room]);

  const valid = name.trim().length > 0 && code.trim().length > 0 && capacity >= 1;

  async function submit() {
    if (!valid) return;
    const placement = {
      building_id: buildingId || null,
      floor: floor.trim() === '' ? null : Number(floor),
    };
    const owner = {
      ownership,
      landlord_name: ownership === 'LANDLORD' ? landlordName.trim() || null : null,
      landlord_phone: ownership === 'LANDLORD' ? landlordPhone.trim() || null : null,
    };
    try {
      if (room) {
        await update.mutateAsync({
          id: room.id,
          input: { name: name.trim(), code: code.trim(), type, capacity, notes: notes.trim() || null, ...placement, ...owner },
        });
      } else {
        await create.mutateAsync({
          name: name.trim(),
          code: code.trim(),
          type,
          status,
          capacity,
          notes: notes.trim() || null,
          ...placement,
          ...owner,
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

          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="room-building">Building</Label>
              <Select id="room-building" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                <option value="">— Unassigned —</option>
                {(properties ?? []).map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {p.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="room-floor">Floor</Label>
              <Input
                id="room-floor"
                type="number"
                min={0}
                placeholder="—"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="room-owner">Ownership</Label>
            <Select id="room-owner" value={ownership} onChange={(e) => setOwnership(e.target.value as RoomOwnership)}>
              <option value="LIFESTYLE">Lifestyle-owned</option>
              <option value="LANDLORD">Third-party landlord</option>
            </Select>
            <span className="text-xs text-slate-500">
              Repair costs on this unit are attributed to its owner in Expenses.
            </span>
          </div>

          {ownership === 'LANDLORD' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="room-landlord">Landlord name</Label>
                <Input
                  id="room-landlord"
                  placeholder="e.g. Kagiso Properties"
                  value={landlordName}
                  onChange={(e) => setLandlordName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="room-landlord-phone">Landlord phone</Label>
                <Input
                  id="room-landlord-phone"
                  placeholder="+267 …"
                  value={landlordPhone}
                  onChange={(e) => setLandlordPhone(e.target.value)}
                />
              </div>
            </div>
          )}

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

          {isEdit && <ChannelSyncSection roomId={room!.id} />}
          {isEdit && <GuestCheckinSection roomId={room!.id} />}

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

/**
 * Channel sync (H4) — the two halves of the Booking.com handshake for one unit:
 *  export: OUR availability feed URL to paste INTO the extranet (copy button);
 *  import: THEIR calendar URL to pull FROM (validated server-side: https + booking.com).
 * The rotate action mints a new export URL, killing the old one instantly.
 */
function ChannelSyncSection({ roomId }: { roomId: string }) {
  const { data: full } = useRoom(roomId);
  const setConfig = useSetChannelConfig();
  const rotate = useRotateIcalToken();

  const [importUrl, setImportUrl] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    setImportUrl(full?.booking_ical_url ?? '');
    setConfirmRotate(false);
  }, [full?.booking_ical_url]);

  if (!full?.ical_token) return null;

  // The Vercel origin proxies /api/* to the engine, so this URL is stable for OTAs.
  const exportUrl = `${window.location.origin}/api/v1/ical/units/${full.ical_token}.ics`;
  const busy = setConfig.isPending || rotate.isPending;
  const dirty = (importUrl.trim() || null) !== (full.booking_ical_url ?? null);

  return (
    <div className="mt-2 flex flex-col gap-3 border-t border-slate-100 pt-4">
      <Label>Channel sync — Booking.com</Label>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">
          Our availability feed — paste this into the Booking.com extranet (Rates &amp; Availability → Sync calendars):
        </span>
        <div className="flex gap-2">
          <Input readOnly value={exportUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(exportUrl).then(
                () => toast.success('Export link copied'),
                () => toast.error('Could not copy — select the text and copy manually'),
              );
            }}
          >
            Copy
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">
          Booking.com&apos;s calendar for this unit — their .ics export link (leave empty to unlink):
        </span>
        <div className="flex gap-2">
          <Input
            placeholder="https://ical.booking.com/v1/export?t=…"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            disabled={busy || !dirty}
            onClick={() => setConfig.mutate({ id: roomId, url: importUrl.trim() || null })}
          >
            {setConfig.isPending && <Spinner />} Save
          </Button>
        </div>
      </div>

      {!confirmRotate ? (
        <button
          type="button"
          className="self-start text-xs text-slate-500 underline hover:text-slate-700"
          onClick={() => setConfirmRotate(true)}
        >
          Rotate export link (if it leaked)
        </button>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <span className="text-sm text-amber-800">
            Rotating kills the current link — Booking.com stops syncing until the new one is pasted into the extranet.
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirmRotate(false)} disabled={busy}>
              Keep
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => rotate.mutate(roomId)}>
              {rotate.isPending && <Spinner />} Rotate
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Guest self check-in (P5.1) — the in-apartment QR. This is the link the printed
 * QR sticker encodes; a guest who scans it lands on /stay/checkin and hands over
 * their own details, capturing an OTA guest into the CRM. Rotating reprints.
 */
function GuestCheckinSection({ roomId }: { roomId: string }) {
  const { data: full } = useRoom(roomId);
  const rotate = useRotateGuestToken();
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => { setConfirmRotate(false); }, [full?.guest_qr_token]);

  if (!full?.guest_qr_token) return null;

  // Guests scan this into the public booking site (lsp-book), not the ops app.
  // VITE_PUBLIC_WEB_URL points at it in production; fall back to this app's origin
  // (local dev, or before the env var is configured) so the link is never broken.
  const publicWebBase =
    (import.meta.env.VITE_PUBLIC_WEB_URL as string | undefined)?.replace(/\/$/, '') ||
    window.location.origin;
  const checkinUrl = `${publicWebBase}/stay/checkin?t=${full.guest_qr_token}`;

  return (
    <div className="mt-2 flex flex-col gap-3 border-t border-slate-100 pt-4">
      <Label>Guest check-in QR</Label>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">
          Turn this link into a QR sticker for the apartment — guests scan it to confirm their details:
        </span>
        <div className="flex gap-2">
          <Input readOnly value={checkinUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(checkinUrl).then(
                () => toast.success('Check-in link copied'),
                () => toast.error('Could not copy — select the text and copy manually'),
              );
            }}
          >
            Copy
          </Button>
        </div>
      </div>

      {!confirmRotate ? (
        <button
          type="button"
          className="self-start text-xs text-slate-500 underline hover:text-slate-700"
          onClick={() => setConfirmRotate(true)}
        >
          Rotate check-in code (if the QR was misused)
        </button>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <span className="text-sm text-amber-800">
            Rotating invalidates the current QR — you’ll need to reprint the sticker for this unit.
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirmRotate(false)} disabled={rotate.isPending}>
              Keep
            </Button>
            <Button variant="outline" disabled={rotate.isPending} onClick={() => rotate.mutate(roomId)}>
              {rotate.isPending && <Spinner />} Rotate
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
