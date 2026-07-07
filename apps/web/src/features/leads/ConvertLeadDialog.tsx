import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { GuestPicker, type PickedGuest } from '@/features/reservations/GuestPicker';
import { useRooms } from '@/features/rooms/hooks';
import { todayISO } from '@/lib/utils/date';
import { useConvertLead } from './hooks';
import type { Lead } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  /** Called after a successful conversion (e.g. to close the parent drawer). */
  onConverted?: () => void;
}

/**
 * Turn an enquiry into a booking: pick the guest (or use the one already linked to
 * the enquiry), a unit and dates. The server creates a PENDING reservation and marks
 * the enquiry converted — the usual money loop still confirms it.
 */
export function ConvertLeadDialog({ open, onOpenChange, lead, onConverted }: Props) {
  const convert = useConvertLead();
  const { data: rooms } = useRooms();

  const [guest, setGuest] = useState<PickedGuest | null>(null);
  const [roomId, setRoomId] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setGuest(null);
    setRoomId('');
    setCheckIn('');
    setCheckOut('');
    setNotes('');
  }, [open]);

  // The enquiry may already be linked to a guest; otherwise one must be picked here.
  const hasGuest = Boolean(guest || lead.contact_id);
  const valid = hasGuest && roomId && checkIn && checkOut && checkIn < checkOut;

  async function submit() {
    if (!valid) return;
    try {
      await convert.mutateAsync({
        id: lead.id,
        input: {
          contact_id: guest?.id,
          room_id: roomId,
          check_in_date: checkIn,
          check_out_date: checkOut,
          notes: notes.trim() || undefined,
        },
      });
      onOpenChange(false);
      onConverted?.();
    } catch {
      /* hook surfaces the error toast; keep the dialog open */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert to booking</DialogTitle>
          <DialogDescription>Create a reservation from “{lead.title}”. It’s pending until payment, as usual.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label>Guest</Label>
            <GuestPicker value={guest} onChange={setGuest} disabled={convert.isPending} />
            {lead.contact_id && !guest && (
              <span className="text-xs text-slate-500">Using the guest already linked to this enquiry. Pick another to override.</span>
            )}
            {!lead.contact_id && !guest && (
              <span className="text-xs text-slate-500">This enquiry has no guest yet — search for one, or add them under Guests first.</span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="cv-room">Unit</Label>
            <Select id="cv-room" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={convert.isPending}>
              <option value="">— Choose a unit —</option>
              {(rooms ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="cv-in">Check-in</Label>
              <Input id="cv-in" type="date" min={todayISO()} value={checkIn} max={checkOut || undefined} onChange={(e) => setCheckIn(e.target.value)} disabled={convert.isPending} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cv-out">Check-out</Label>
              <Input id="cv-out" type="date" min={checkIn || todayISO()} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} disabled={convert.isPending} />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="cv-notes">Notes (optional)</Label>
            <Input id="cv-notes" placeholder="Anything to carry onto the booking" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={convert.isPending} />
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={convert.isPending}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={convert.isPending || !valid}>
              {convert.isPending && <Spinner className="text-white" />} Create booking
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
