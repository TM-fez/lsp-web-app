import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { GuestPicker, type PickedGuest } from './GuestPicker';
import {
  useCreateReservation,
  useUpdateReservation,
  useCancelReservation,
  useAvailability,
  useSetDiscount,
  useApproveDiscount,
  useRemoveDiscount,
  useReservationPricing,
} from './hooks';
import { nights, statusLabel, statusTone, isOpen, fmtDate } from './util';
import { todayISO } from '@/lib/utils/date';
import { formatMoney } from '@/lib/utils/money';
import { useAuthStore } from '@/store/auth';
import type { Reservation, Room } from '@/types';

const toDateInput = (s?: string | null) => (s ? s.slice(0, 10) : '');

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservation?: Reservation | null;
  rooms: Room[];
  canUpdate?: boolean;
  canCancel?: boolean;
}

export function ReservationFormDrawer({ open, onOpenChange, reservation, rooms, canUpdate, canCancel }: Props) {
  const isEdit = !!reservation;
  // Editable only if the user may update AND the reservation is still open.
  const editable = isEdit ? !!canUpdate && isOpen(reservation!.status) : true;

  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canRequestDiscount = hasPerm('reservations.discount.request');
  const canApproveDiscount = hasPerm('reservations.discount.approve');

  const create = useCreateReservation();
  const update = useUpdateReservation();
  const cancel = useCancelReservation();
  const setDiscM = useSetDiscount();
  const approveDisc = useApproveDiscount();
  const removeDisc = useRemoveDiscount();
  // Amount-due breakdown — only meaningful for an existing pending booking.
  const showDiscountTools = isEdit && reservation!.status === 'PENDING' && canRequestDiscount;
  const pricing = useReservationPricing(reservation?.id, open && showDiscountTools);
  const busy =
    create.isPending ||
    update.isPending ||
    cancel.isPending ||
    setDiscM.isPending ||
    approveDisc.isPending ||
    removeDisc.isPending;

  const [guest, setGuest] = useState<PickedGuest | null>(null);
  const [roomId, setRoomId] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [discType, setDiscType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [discValue, setDiscValue] = useState('');
  const [discReason, setDiscReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setGuest(reservation ? { id: reservation.contact_id, name: reservation.guest_name ?? 'Guest' } : null);
    setRoomId(reservation?.room_id ?? '');
    setCheckIn(toDateInput(reservation?.check_in_date));
    setCheckOut(toDateInput(reservation?.check_out_date));
    setNotes(reservation?.notes ?? '');
    setConfirmCancel(false);
    setDiscType('PERCENT');
    setDiscValue('');
    setDiscReason('');
  }, [open, reservation]);

  // Bookable rooms (always keep the currently-selected room visible on edit).
  const roomOptions = useMemo(
    () =>
      rooms.filter(
        (r) => r.id === roomId || (r.status !== 'MAINTENANCE' && r.status !== 'OUT_OF_SERVICE'),
      ),
    [rooms, roomId],
  );

  const datesOrdered = !!checkIn && !!checkOut && checkIn < checkOut;
  const stayNights = datesOrdered ? nights(checkIn, checkOut) : 0;

  // Live availability only on create (the modify endpoint can't exclude self).
  const availEnabled = !isEdit && !!roomId && datesOrdered && checkIn >= todayISO();
  const availability = useAvailability(
    { room_id: roomId, check_in_date: checkIn, check_out_date: checkOut },
    availEnabled,
  );
  const unavailable = availEnabled && availability.data === false;

  const valid =
    !!guest && !!roomId && datesOrdered && (isEdit || checkIn >= todayISO()) && !unavailable;

  async function submit() {
    if (!valid || !guest) return;
    const payload = {
      contact_id: guest.id,
      room_id: roomId,
      check_in_date: checkIn,
      check_out_date: checkOut,
      notes: notes.trim() || null,
    };
    try {
      if (reservation) {
        await update.mutateAsync({ id: reservation.id, input: payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      /* hook surfaces the error toast; keep the drawer open */
    }
  }

  async function doCancel() {
    if (!reservation) return;
    try {
      await cancel.mutateAsync(reservation.id);
      onOpenChange(false);
    } catch {
      /* toast shown by hook */
    }
  }

  function applyDiscount() {
    if (!reservation || !discValue) return;
    const value = discType === 'PERCENT' ? Math.round(parseFloat(discValue)) : Math.round(parseFloat(discValue) * 100);
    setDiscM.mutate({
      id: reservation.id,
      input: { discount_type: discType, discount_value: value, discount_reason: discReason.trim() || null },
    });
  }

  // ── Read-only view for closed reservations (checked-in/out, cancelled) ───────
  if (isEdit && !editable) {
    const r = reservation!;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reservation details</DialogTitle>
            <DialogDescription>
              This reservation is {statusLabel(r.status)} and can no longer be edited here.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <Row label="Status">
              <Badge tone={statusTone[r.status]}>{statusLabel(r.status)}</Badge>
            </Row>
            <Row label="Guest">{r.guest_name ?? '—'}</Row>
            <Row label="Unit">{r.room_code ? `${r.room_code} · ${r.room_name ?? ''}` : '—'}</Row>
            <Row label="Stay">
              {fmtDate(r.check_in_date)} → {fmtDate(r.check_out_date)} ({nights(r.check_in_date, r.check_out_date)}{' '}
              night{nights(r.check_in_date, r.check_out_date) === 1 ? '' : 's'})
            </Row>
            {r.notes && <Row label="Notes">{r.notes}</Row>}
          </div>
          <div className="flex justify-end pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Create / edit form ──────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Manage reservation' : 'New reservation'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the guest, unit or dates. Changing dates re-checks availability.'
              : 'Hold a unit for a guest. New bookings are pending until payment confirms them.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label>Guest</Label>
            <GuestPicker value={guest} onChange={setGuest} disabled={busy} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="res-room">Unit</Label>
            <Select id="res-room" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={busy}>
              <option value="">Select a unit…</option>
              {roomOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="res-in">Check-in</Label>
              <Input
                id="res-in"
                type="date"
                min={isEdit ? undefined : todayISO()}
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="res-out">Check-out</Label>
              <Input
                id="res-out"
                type="date"
                min={checkIn || (isEdit ? undefined : todayISO())}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          {!!checkIn && !!checkOut && !datesOrdered && (
            <span className="text-xs text-rose-600">Check-out must be after check-in.</span>
          )}
          {datesOrdered && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">
                {stayNights} night{stayNights === 1 ? '' : 's'}
              </span>
              {availEnabled && availability.isFetching && <Spinner className="h-3.5 w-3.5 text-slate-400" />}
              {availEnabled && availability.data === true && <span className="text-emerald-600">✓ Available</span>}
              {unavailable && <span className="text-rose-600">✕ Not available for these dates</span>}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="res-notes">Notes (optional)</Label>
            <textarea
              id="res-notes"
              rows={2}
              placeholder="Special requests, corporate ref, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={busy}
              className="flex w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            />
          </div>

          {(!isEdit || reservation!.status === 'PENDING') && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Bookings stay <strong>pending</strong> until payment is received — payment is what confirms a
              reservation. Take payment from the cockpit to confirm.
            </p>
          )}

          {showDiscountTools && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <Label className="text-[11px] uppercase tracking-[0.18em] text-muted">Discount</Label>

              {pricing.data?.priceable && (
                <div className="rounded-md border border-line bg-cream-2/40 px-3 py-2.5 text-sm">
                  <div className="flex items-center justify-between text-muted">
                    <span>Stay · {pricing.data.nights} night{pricing.data.nights === 1 ? '' : 's'}</span>
                    <span className="text-ink">{formatMoney(pricing.data.base_amount)}</span>
                  </div>
                  {pricing.data.discount && pricing.data.discount.amount > 0 && (
                    <div className="flex items-center justify-between text-terra">
                      <span>
                        Discount
                        {pricing.data.discount.type === 'PERCENT' ? ` (${pricing.data.discount.value}%)` : ''}
                      </span>
                      <span>−{formatMoney(pricing.data.discount.amount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-muted">
                    <span>Tax ({(pricing.data.tax_rate_bps / 100).toFixed(0)}%)</span>
                    <span className="text-ink">{formatMoney(pricing.data.tax_amount)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 font-medium text-ink">
                    <span>Total due</span>
                    <span className="font-display">{formatMoney(pricing.data.total_amount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>Deposit to confirm ({pricing.data.deposit_pct}%)</span>
                    <span>{formatMoney(pricing.data.deposit_amount)}</span>
                  </div>
                  {pricing.data.discount && !pricing.data.discount.approved && (
                    <p className="mt-1.5 text-xs text-terra">
                      Discount is pending approval — not applied to the total yet.
                    </p>
                  )}
                </div>
              )}
              {pricing.data && !pricing.data.priceable && (
                <p className="rounded-md border border-line bg-cream-2/40 px-3 py-2 text-xs text-muted">
                  Can’t price this booking automatically — {pricing.data.reason}.
                </p>
              )}

              {reservation!.discount_value != null ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-cream-2/60 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-ink">
                      {reservation!.discount_type === 'PERCENT'
                        ? `${reservation!.discount_value}% off`
                        : `${formatMoney(reservation!.discount_value)} off`}
                      {reservation!.discount_reason ? (
                        <span className="text-muted"> · {reservation!.discount_reason}</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs">
                      {reservation!.discount_approved_at ? (
                        <span className="text-forest">✓ Approved</span>
                      ) : (
                        <span className="text-terra">Pending Tameem’s approval</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!reservation!.discount_approved_at && canApproveDiscount && (
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => approveDisc.mutate(reservation!.id)}>
                        Approve
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeDisc.mutate(reservation!.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[8.5rem_1fr] gap-3">
                    <Select
                      value={discType}
                      onChange={(e) => setDiscType(e.target.value as 'PERCENT' | 'FIXED')}
                      disabled={busy}
                    >
                      <option value="PERCENT">Percent %</option>
                      <option value="FIXED">Amount (P)</option>
                    </Select>
                    <Input
                      type="number"
                      min="1"
                      placeholder={discType === 'PERCENT' ? 'e.g. 15' : 'e.g. 200'}
                      value={discValue}
                      onChange={(e) => setDiscValue(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <Input
                    placeholder="Reason (e.g. loyal guest, corporate)"
                    value={discReason}
                    onChange={(e) => setDiscReason(e.target.value)}
                    disabled={busy}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">
                      {canApproveDiscount ? 'Applies immediately.' : 'Needs Tameem’s sign-off before it counts.'}
                    </span>
                    <Button size="sm" variant="outline" disabled={busy || !discValue} onClick={applyDiscount}>
                      {canApproveDiscount ? 'Apply discount' : 'Request discount'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !valid}>
              {busy && <Spinner className="text-white" />} {isEdit ? 'Save changes' : 'Create reservation'}
            </Button>
          </div>

          {isEdit && canCancel && isOpen(reservation!.status) && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label className="text-rose-600">Danger zone</Label>
              {!confirmCancel ? (
                <Button variant="outline" onClick={() => setConfirmCancel(true)} disabled={busy}>
                  Cancel this reservation
                </Button>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
                  <span className="text-sm text-rose-700">Cancel this booking and free the unit?</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setConfirmCancel(false)} disabled={busy}>
                      Keep
                    </Button>
                    <Button variant="danger" onClick={doCancel} disabled={busy}>
                      {busy && <Spinner className="text-white" />} Cancel booking
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-slate-400">{label}</span>
      <span className="font-medium text-slate-800">{children}</span>
    </div>
  );
}
