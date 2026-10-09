import { useEffect, useMemo, useRef, useState } from 'react';
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
  useRemoveReservation,
  useAvailability,
  useSetDiscount,
  useApproveDiscount,
  useRemoveDiscount,
  useReservationPricing,
  useClaimOtaBooking,
  useMarkPaid,
  useMarkNoShow,
  useFolio,
  useConfirmReservation,
} from './hooks';
import { nights, statusLabel, statusTone, paymentTone, paymentLabel, isOpen, fmtDate, sourceLabel, SOURCES, discountBlockedReason, parseDiscountInput } from './util';
import { todayISO } from '@/lib/utils/date';
import { formatMoney, isPulaAmount, pulaToThebe } from '@/lib/utils/money';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { errMessage, fullRefundMessage } from '@/lib/api/errors';
import { AmountError } from '@/components/ui/amount-error';
import { useAuthStore } from '@/store/auth';
import { useRefundInvoice } from '@/features/invoices/hooks';
import type { Reservation, ReservationSource, Room, PaymentMethod, ReservationFolio } from '@/types';

const toDateInput = (s?: string | null) => (s ? s.slice(0, 10) : '');

// How the money actually arrived. Plain wording, not the stored enum — staff read this.
const PAY_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'EFT', label: 'Bank transfer (EFT)' },
  { value: 'MOBILE_MONEY', label: 'Mobile money' },
  { value: 'CARD', label: 'Card' },
  { value: 'CORPORATE_CREDIT', label: 'Company account' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservation?: Reservation | null;
  rooms: Room[];
  canUpdate?: boolean;
  canCancel?: boolean;
  /**
   * (Calendar) A new booking started from an empty square on the board: that unit and that
   * night are filled in. Ignored when editing. Pass a stable object — it resets the form.
   */
  initial?: { room_id?: string; check_in_date?: string; check_out_date?: string } | null;
}

export function ReservationFormDrawer({ open, onOpenChange, reservation, rooms, canUpdate, canCancel, initial }: Props) {
  const isEdit = !!reservation;
  // Editable only if the user may update AND the reservation is still open.
  const editable = isEdit ? !!canUpdate && isOpen(reservation!.status) : true;

  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canRequestDiscount = hasPerm('reservations.discount.request');
  const canApproveDiscount = hasPerm('reservations.discount.approve');

  const create = useCreateReservation();
  const update = useUpdateReservation();
  const cancel = useCancelReservation();
  const remove = useRemoveReservation();
  const setDiscM = useSetDiscount();
  const approveDisc = useApproveDiscount();
  const removeDisc = useRemoveDiscount();
  const markPaid = useMarkPaid();
  const markNoShow = useMarkNoShow();
  const confirmNoPay = useConfirmReservation();
  // The booking's money. Fetched for any existing booking — staff should be able to see
  // what is owed even on a cancelled one, where it decides whether a refund is due.
  const folio = useFolio(reservation?.id, open && isEdit);
  const outstanding = folio.data?.outstanding_amount ?? 0;

  // Discounts stay available while the stay is still open, not only while it is unpaid.
  // A CONFIRMED booking that nobody has paid for can still be discounted — before the
  // decoupling, confirming meant paying, so PENDING was a fair proxy for "still
  // negotiable". It no longer is.
  const showDiscountTools =
    isEdit && canRequestDiscount && ['PENDING', 'CONFIRMED'].includes(reservation!.status);
  // …but the SERVER only takes a new discount while the booking is PENDING (409 otherwise),
  // so the form is offered only then; a confirmed booking gets the reason in words instead.
  const discountBlocked = isEdit ? discountBlockedReason(reservation!.status) : null;
  // Recording a payment needs BOTH: raising the intent and settling it are separate
  // permissions, and reception holds only the first — so the button stays hidden
  // rather than showing them an action that 403s halfway through.
  const canTakePayment = hasPerm('payments.create') && hasPerm('payments.update');
  // Money can arrive at any point in a live stay, INCLUDING after it — that is the
  // whole point of pay-later, since a guest who settles afterwards is CHECKED_OUT by
  // then. Mirrors the server's own whitelist in markPaid.
  const isPayableStatus = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'].includes(
    reservation?.status ?? ''
  );
  const showPayment = isEdit && canTakePayment && isPayableStatus && outstanding > 0;
  // Confirm a stay with no money in hand. PENDING only — anything further along is
  // already confirmed or is over.
  const showConfirm = isEdit && !!canUpdate && reservation!.status === 'PENDING';
  // No-show: only a CONFIRMED booking whose arrival day has already passed. Mirrors the
  // server's rule (markNoShow) so the button never offers something the API refuses.
  const showNoShow =
    isEdit &&
    !!canUpdate &&
    reservation!.status === 'CONFIRMED' &&
    toDateInput(reservation!.check_in_date) < todayISO();
  const pricing = useReservationPricing(reservation?.id, open && showDiscountTools);
  const busy =
    create.isPending ||
    update.isPending ||
    cancel.isPending ||
    setDiscM.isPending ||
    approveDisc.isPending ||
    removeDisc.isPending ||
    markPaid.isPending ||
    markNoShow.isPending ||
    confirmNoPay.isPending;

  const [guest, setGuest] = useState<PickedGuest | null>(null);
  // CRM (A4): who arranged the booking + who the invoice goes to (both optional).
  const [coordinator, setCoordinator] = useState<PickedGuest | null>(null);
  const [billingContact, setBillingContact] = useState<PickedGuest | null>(null);
  const [roomId, setRoomId] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [notes, setNotes] = useState('');
  const [source, setSource] = useState<ReservationSource>('WALK_IN');
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Recording a payment — how it was taken, the guest's reference, and a confirm
  // step, because this one moves money and cannot be undone from here.
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [payReference, setPayReference] = useState('');
  const [confirmPay, setConfirmPay] = useState(false);
  // Kept as a STRING, like every other field here: parsing on each keystroke would
  // fight the user mid-type ("1." is not a number yet). Converted to thebe once, below.
  const [payAmount, setPayAmount] = useState('');
  const [confirmNoPayStep, setConfirmNoPayStep] = useState(false);
  const [confirmNote, setConfirmNote] = useState('');

  // Pula in the box, thebe on the wire (invariant 1 — money never travels as a float).
  // An empty box means "all of it", which is the common case at the desk.
  const payAmountThebe = payAmount.trim() === '' ? null : pulaToThebe(payAmount);
  const payAmountWellFormed = payAmount.trim() === '' || isPulaAmount(payAmount);
  const payAmountValid =
    payAmountThebe === null || (payAmountWellFormed && payAmountThebe > 0 && payAmountThebe <= outstanding);
  // One Idempotency-Key per time the drawer opens: pressing "Yes — record" twice, or a retry
  // after a slow network, replays the same payment instead of taking it twice. The server
  // forgets a key whose request was refused, so fixing the amount and re-sending is fine.
  const [discountFailure, setDiscountFailure] = useState<string | null>(null);
  const payKey = useRef('');
  useEffect(() => {
    if (!open) return;
    payKey.current = newIdempotencyKey();
    // A discount error from a previous visit to this drawer is not news any more.
    setDiscountFailure(null);
  }, [open]);
  const [confirmNoShow, setConfirmNoShow] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [discType, setDiscType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [discValue, setDiscValue] = useState('');
  const [discReason, setDiscReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setGuest(reservation ? { id: reservation.contact_id, name: reservation.guest_name ?? 'Guest' } : null);
    setCoordinator(
      reservation?.booking_coordinator_id
        ? { id: reservation.booking_coordinator_id, name: reservation.booking_coordinator_name ?? 'Contact' }
        : null,
    );
    setBillingContact(
      reservation?.billing_contact_id
        ? { id: reservation.billing_contact_id, name: reservation.billing_contact_name ?? 'Contact' }
        : null,
    );
    const start = reservation ? null : initial;
    setRoomId(reservation?.room_id ?? start?.room_id ?? '');
    setCheckIn(toDateInput(reservation?.check_in_date ?? start?.check_in_date));
    setCheckOut(toDateInput(reservation?.check_out_date ?? start?.check_out_date));
    setNotes(reservation?.notes ?? '');
    setSource(reservation?.source ?? 'WALK_IN');
    setConfirmCancel(false);
    setPayMethod('CASH');
    setPayReference('');
    setPayAmount('');
    setConfirmPay(false);
    setConfirmNoPayStep(false);
    setConfirmNote('');
    setConfirmNoShow(false);
    setDiscType('PERCENT');
    setDiscValue('');
    setDiscReason('');
  }, [open, reservation, initial]);

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

  // (Re-test 3) A double click on "Create reservation" sent a second request before the
  // button re-rendered disabled; the server refused the overlap, but the user saw a
  // confusing "not available" toast on top of the success. A ref drops the second click.
  const submitting = useRef(false);
  async function submit() {
    if (!valid || !guest || submitting.current) return;
    submitting.current = true;
    const payload = {
      contact_id: guest.id,
      room_id: roomId,
      check_in_date: checkIn,
      check_out_date: checkOut,
      notes: notes.trim() || null,
      source,
      booking_coordinator_id: coordinator?.id ?? null,
      billing_contact_id: billingContact?.id ?? null,
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
    } finally {
      submitting.current = false;
    }
  }

  async function doNoShow() {
    if (!reservation) return;
    try {
      await markNoShow.mutateAsync(reservation.id);
      onOpenChange(false);
    } catch {
      /* toast shown by hook */
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

  async function doRemove() {
    if (!reservation) return;
    try {
      await remove.mutateAsync(reservation.id);
      onOpenChange(false);
    } catch {
      /* toast shown by hook */
    }
  }

  // What was typed in the discount box, in the units the API wants (whole percent / thebe).
  const parsedDiscount = parseDiscountInput(discType, discValue);

  function applyDiscount() {
    if (!reservation || parsedDiscount.value === null || setDiscM.isPending) return;
    setDiscountFailure(null);
    setDiscM.mutate(
      {
        id: reservation.id,
        input: { discount_type: discType, discount_value: parsedDiscount.value, discount_reason: discReason.trim() || null },
      },
      { onError: (e) => setDiscountFailure(errMessage(e)) },
    );
  }

  // A refused discount / approval / removal is also shown IN the drawer, not only as a toast
  // that fades: the person has to see why the price did not change (the hook still toasts).
  const discountMutate = (m: typeof approveDisc | typeof removeDisc) => {
    setDiscountFailure(null);
    m.mutate(reservation!.id, { onError: (e: unknown) => setDiscountFailure(errMessage(e)) });
  };

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
            {r.booking_coordinator_name && <Row label="Coordinator">{r.booking_coordinator_name}</Row>}
            {r.billing_contact_name && <Row label="Bill to">{r.billing_contact_name}</Row>}
            <Row label="Unit">{r.room_code ? `${r.room_code} · ${r.room_name ?? ''}` : '—'}</Row>
            <Row label="Source">{sourceLabel(r.source)}</Row>
            <Row label="Stay">
              {fmtDate(r.check_in_date)} → {fmtDate(r.check_out_date)} ({nights(r.check_in_date, r.check_out_date)}{' '}
              night{nights(r.check_in_date, r.check_out_date) === 1 ? '' : 's'})
            </Row>
            {r.notes && <Row label="Notes">{r.notes}</Row>}
            {/* (R8 #3) Removing a cancelled booking that still holds money says "refund it from
                the booking first" — so the booking shows what it holds and can refund it. */}
            {folio.data && folio.data.paid_amount > 0 && (
              <Row label="Money">
                {formatMoney(folio.data.paid_amount)} received
                {fullyRefunded(folio.data) ? ' — fully refunded' : ''}
              </Row>
            )}
          </div>
          {folio.data && <RefundFromBooking folio={folio.data} status={r.status} />}
          {r.status === 'BLOCKED' && r.source === 'BOOKING_COM' && canUpdate && (
            <ClaimBookingSection reservationId={r.id} onClaimed={() => onOpenChange(false)} />
          )}
          {r.status === 'CANCELLED' && canCancel && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label className="text-rose-600">Danger zone</Label>
              {!confirmRemove ? (
                <Button variant="outline" onClick={() => setConfirmRemove(true)} disabled={remove.isPending}>
                  Remove from list
                </Button>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
                  <span className="text-sm text-rose-700">
                    Remove this cancelled booking from the list? It stays on record but is hidden everywhere.
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" onClick={() => setConfirmRemove(false)} disabled={remove.isPending}>
                      Keep
                    </Button>
                    <Button variant="danger" onClick={doRemove} disabled={remove.isPending}>
                      {remove.isPending && <Spinner className="text-white" />} Remove
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
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

          {/* CRM (A4): corporate bookings carry who arranged it + who the invoice
              goes to. Both optional — individual stays leave them empty. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label>Booking coordinator (optional)</Label>
              <GuestPicker value={coordinator} onChange={setCoordinator} disabled={busy} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Billing contact (optional)</Label>
              <GuestPicker value={billingContact} onChange={setBillingContact} disabled={busy} />
              <span className="text-xs text-slate-500">Invoices go here instead of the guest.</span>
            </div>
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
            <Label htmlFor="res-source">Booking source</Label>
            <Select
              id="res-source"
              value={source}
              onChange={(e) => setSource(e.target.value as ReservationSource)}
              disabled={busy}
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </Select>
          </div>

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

          {!isEdit && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              New bookings start <strong>pending</strong>. A pending booking already holds the unit — nobody
              else can be booked into it — so you can take the details now and settle the money later.
            </p>
          )}

          {/* ── The money on this booking ─────────────────────────────────────────
              Shown for any existing booking, including cancelled ones, where what was
              received decides whether a refund is owed. Deliberately separate from the
              STATUS badge above: since 2026-09-07 a booking can be confirmed, or the
              guest already in the unit, with nothing paid. */}
          {isEdit && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <Label className="text-[11px] uppercase tracking-[0.18em] text-muted">Money</Label>

              {folio.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Spinner className="h-3.5 w-3.5" /> Working out what’s been paid…
                </div>
              ) : folio.isError ? (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  Couldn’t load this booking’s payments, so the amounts below are unknown — don’t quote a
                  balance from this screen until it loads.{' '}
                  <button type="button" onClick={() => folio.refetch()} className="underline">
                    Try again
                  </button>
                </div>
              ) : (
                folio.data && (
                  <div className="rounded-md border border-line bg-cream-2/40 px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      {/* (Round 11) "P3,249 of P2,166 paid" with a "paid" badge read oddly: more
                          than everything is not "of". An overpaid stay says what came in against
                          what was agreed, and its badge says overpaid (the refund-due line below
                          says what to do). */}
                      <span className="font-display text-lg text-ink">
                        {folio.data.credit_amount > 0
                          ? `${formatMoney(folio.data.paid_amount)} paid — agreed ${formatMoney(folio.data.total_amount)}`
                          : `${formatMoney(folio.data.paid_amount)} of ${formatMoney(folio.data.total_amount)} paid`}
                      </span>
                      {/* (R8 #2) "P0.00 of P0.00 — paid" after a full refund read as if the guest
                          had paid in full; the badge now says what the words below say. */}
                      {fullyRefunded(folio.data) ? (
                        <Badge tone="slate" className="shrink-0">fully refunded</Badge>
                      ) : folio.data.credit_amount > 0 ? (
                        <Badge tone="amber" className="shrink-0">overpaid</Badge>
                      ) : (
                        <Badge tone={paymentTone[folio.data.payment_state]} className="shrink-0">
                          {paymentLabel[folio.data.payment_state]}
                        </Badge>
                      )}
                    </div>

                    {/* (2026-10-04) A stay agreed at P0 has no invoice by design — nothing is
                        owed — so say so rather than leave it looking like a missing one.
                        (R6) A FULL refund also brings the agreed total to P0 (refunding lowers
                        it, 2026-10-02), but it has a receipt and a credit note — so it is
                        "fully refunded", never "complimentary". */}
                    {folio.data.total_amount === 0 && folio.data.total_source === 'FOLIO' && (
                      fullyRefunded(folio.data) ? (
                        <p className="mt-1 text-sm text-muted">Fully refunded — everything paid has gone back to the guest, so nothing is owed.</p>
                      ) : (
                        <p className="mt-1 text-sm text-muted">Complimentary — no charge, so there is no invoice.</p>
                      )
                    )}

                    {/* (R10 #3) After a P500 refund the line read "P1,723 of P1,723 paid" — true
                        (paid is net, and the refund lowered the total) but silent about the
                        P500 that went back. */}
                    {refundedTotal(folio.data) > 0 && !fullyRefunded(folio.data) && (
                      <p className="mt-1 text-sm text-muted">{formatMoney(refundedTotal(folio.data))} refunded</p>
                    )}

                    {folio.data.outstanding_amount > 0 && (
                      <p className="mt-1 text-sm text-terra">
                        {formatMoney(folio.data.outstanding_amount)} still outstanding
                      </p>
                    )}

                    {/* (Re-test 2026-10-04) A stay shortened after payment left more paid than
                        agreed, and the panel just said PAID. */}
                    {folio.data.credit_amount > 0 && (
                      <p className="mt-1 text-sm text-terra">
                        {formatMoney(folio.data.credit_amount)} refund due — the guest has paid more than
                        the agreed price.{hasPerm('invoices.refund') ? ' Refund it below.' : ''}
                      </p>
                    )}

                    {(reservation?.status === 'CANCELLED' || reservation?.status === 'NO_SHOW') && (
                      <p className="mt-1 text-xs text-muted">
                        This booking is {reservation.status === 'CANCELLED' ? 'cancelled' : 'a no-show'}, so nothing
                        is owed.
                        {folio.data.paid_amount > 0 &&
                          ` Whether what was paid is returned depends on your cancellation terms${
                            hasPerm('invoices.refund') ? ' — refund it below if so.' : '.'
                          }`}
                      </p>
                    )}

                    {/* A price that was never agreed on the booking is a live estimate,
                        not a debt. Saying so stops staff quoting a figure the booking
                        does not stand behind. */}
                    {folio.data.total_source === 'PRICED' && (
                      <p className="mt-2 text-[11px] text-muted">
                        No price has been agreed on this booking yet — this is today’s rate for the unit, so it
                        will move if rates do. It is fixed the moment you confirm it or take a payment.
                      </p>
                    )}
                  </div>
                )
              )}

              {folio.data && reservation && (
                <RefundFromBooking folio={folio.data} status={reservation.status} />
              )}

              {showConfirm && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        if (!confirmNoPayStep) {
                          setConfirmNoPayStep(true);
                          return;
                        }
                        try {
                          await confirmNoPay.mutateAsync({
                            id: reservation!.id,
                            note: confirmNote.trim() || undefined,
                          });
                          setConfirmNoPayStep(false);
                        } catch {
                          /* hook surfaces the error toast */
                          setConfirmNoPayStep(false);
                        }
                      }}
                    >
                      {confirmNoPay.isPending ? (
                        <Spinner className="h-4 w-4" />
                      ) : confirmNoPayStep ? (
                        'Yes — confirm, money still owed'
                      ) : (
                        'Confirm without payment'
                      )}
                    </Button>
                    {confirmNoPayStep && !confirmNoPay.isPending && (
                      <Button variant="outline" disabled={busy} onClick={() => setConfirmNoPayStep(false)}>
                        Cancel
                      </Button>
                    )}
                  </div>

                  {confirmNoPayStep ? (
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="res-confirm-note">Why? (optional, but it helps)</Label>
                      <Input
                        id="res-confirm-note"
                        placeholder="Corporate account, settles monthly…"
                        value={confirmNote}
                        onChange={(e) => setConfirmNote(e.target.value)}
                        disabled={busy}
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted">
                      For a guest who pays after their stay. The booking is confirmed and can be checked in;
                      the balance stays outstanding until it is paid.
                    </p>
                  )}
                </div>
              )}

              {isEdit && !canTakePayment && outstanding > 0 && (
                <p className="text-[11px] text-muted">
                  Ask an admin or Accounts to record a payment against this booking.
                </p>
              )}
            </div>
          )}

          {showPayment && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <Label className="text-[11px] uppercase tracking-[0.18em] text-muted">Record a payment</Label>

              <p className="text-xs text-muted">
                Enter what the guest has actually handed over. Paying part of it is fine — the rest stays
                outstanding on the booking.
                {reservation!.status === 'PENDING' && (
                  <> Paying in full also confirms the booking.</>
                )}
                {reservation!.source === 'WEBSITE' && reservation!.status === 'PENDING' && (
                  <> Website bookings are cancelled automatically if they stay unpaid for 24 hours.</>
                )}
              </p>

              <div className="flex flex-col gap-1">
                <Label htmlFor="res-pay-amount">How much did they pay?</Label>
                <Input
                  id="res-pay-amount"
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(e) => {
                    setPayAmount(e.target.value);
                    setConfirmPay(false);
                  }}
                  disabled={busy}
                />
                <p className="text-[11px] text-muted">
                  In pula. Outstanding: {formatMoney(outstanding)}.
                </p>
                <AmountError value={payAmount} positive />
                {payAmountWellFormed && payAmountThebe !== null && payAmountThebe > outstanding && (
                  <p className="text-[11px] text-terra">
                    That is more than this booking still owes.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="res-pay-method">How did they pay?</Label>
                <Select
                  id="res-pay-method"
                  value={payMethod}
                  onChange={(e) => {
                    setPayMethod(e.target.value as PaymentMethod);
                    setConfirmPay(false);
                  }}
                  disabled={busy}
                >
                  {PAY_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="res-pay-ref">Reference (optional)</Label>
                <Input
                  id="res-pay-ref"
                  placeholder="Bank reference, receipt number…"
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  disabled={busy}
                />
              </div>

              {/* (R6 item 20) The confirm step used to turn "Record payment" into "Yes — record"
                  in place, so a double click went straight through it. Confirming now puts
                  Cancel in that spot (a fresh element, keyed) and the real action beside it. */}
              <div className="flex flex-wrap items-center gap-2">
                {confirmPay ? (
                  <>
                    {!markPaid.isPending && (
                      <Button key="pay-cancel" variant="outline" disabled={busy} onClick={() => setConfirmPay(false)}>
                        Cancel
                      </Button>
                    )}
                    <Button
                      key="pay-confirm"
                      variant="primary"
                      disabled={busy || !payAmountValid}
                      onClick={async () => {
                        try {
                          await markPaid.mutateAsync({
                            id: reservation!.id,
                            input: {
                              method: payMethod,
                              amount: payAmountThebe ?? undefined,
                              reference: payReference.trim() || null,
                            },
                            idempotencyKey: payKey.current,
                          });
                          onOpenChange(false);
                        } catch {
                          /* hook surfaces the error toast */
                          setConfirmPay(false);
                        }
                      }}
                    >
                      {markPaid.isPending ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        `Yes — record ${formatMoney(payAmountThebe ?? outstanding)}`
                      )}
                    </Button>
                  </>
                ) : (
                  <Button
                    key="pay-start"
                    variant="primary"
                    disabled={busy || !payAmountValid}
                    onClick={() => setConfirmPay(true)}
                  >
                    Record payment
                  </Button>
                )}
              </div>

              <p className="text-[11px] text-muted">
                Records the payment against this booking. This can’t be undone here.
              </p>
            </div>
          )}

          {showDiscountTools && (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              {/* (R10 #6) "Discount" headed a price box with no discount in it when none could
                  be added any more — the heading now says what the section holds. */}
              <Label className="text-[11px] uppercase tracking-[0.18em] text-muted">
                {reservation!.discount_value != null || !discountBlocked ? 'Price & discount' : 'Price'}
              </Label>

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
                        {pricing.data.discount.type === 'PERCENT'
                          ? ` (${pricing.data.discount.value}%)`
                          : ` (${formatMoney(pricing.data.discount.off_total)} off the total, before VAT)`}
                      </span>
                      <span>−{formatMoney(pricing.data.discount.amount)}</span>
                    </div>
                  )}
                  {pricing.data.tax_amount > 0 && (
                    <div className="flex items-center justify-between text-muted">
                      <span>Tax ({(pricing.data.tax_rate_bps / 100).toFixed(0)}%)</span>
                      <span className="text-ink">{formatMoney(pricing.data.tax_amount)}</span>
                    </div>
                  )}
                  {/* (R9 #5) Once a total is agreed (frozen on the folio), THAT is what is due —
                      a full refund brings it to P0 — and the figure above is only today's price
                      for the stay. Calling today's price "Total due" contradicted "P0 of P0 paid". */}
                  {folio.data?.total_source === 'FOLIO' ? (
                    <>
                      <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 text-muted">
                        <span>Price at today’s rates</span>
                        <span className="text-ink">{formatMoney(pricing.data.total_amount)}</span>
                      </div>
                      <div className="flex items-center justify-between font-medium text-ink">
                        <span>
                          {folio.data.invoices.some((i) => i.kind === 'REFUND') ? 'Agreed total (after refunds)' : 'Agreed total'}
                        </span>
                        <span className="font-display">{formatMoney(folio.data.total_amount)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 font-medium text-ink">
                      <span>Total due</span>
                      <span className="font-display">{formatMoney(pricing.data.total_amount)}</span>
                    </div>
                  )}
                  {/* (R10 #5) Only a PENDING booking still needs confirming — once it is
                      confirmed (paid or vouched for) this line was advice for a step already done. */}
                  {reservation!.status === 'PENDING' && (
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Deposit to confirm ({pricing.data.deposit_pct}%)</span>
                      <span>{formatMoney(pricing.data.deposit_amount)}</span>
                    </div>
                  )}
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

              {discountFailure && (
                <p role="alert" className="rounded-md border border-terra/40 bg-terra/5 px-3 py-2 text-xs text-terra">
                  {discountFailure}
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
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => discountMutate(approveDisc)}>
                        Approve
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => discountMutate(removeDisc)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ) : discountBlocked ? (
                <p className="rounded-md border border-line bg-cream-2/40 px-3 py-2 text-xs text-muted">{discountBlocked}</p>
              ) : (
                <>
                  <div className="grid grid-cols-[8.5rem_1fr] gap-3">
                    <Select
                      value={discType}
                      onChange={(e) => {
                        setDiscType(e.target.value as 'PERCENT' | 'FIXED');
                        setDiscValue('');
                      }}
                      disabled={busy}
                    >
                      <option value="PERCENT">Percent %</option>
                      <option value="FIXED">Amount (P)</option>
                    </Select>
                    <Input
                      inputMode="decimal"
                      aria-label={discType === 'PERCENT' ? 'Discount percentage' : 'Discount amount in pula'}
                      placeholder={discType === 'PERCENT' ? 'e.g. 15' : 'e.g. 200.00'}
                      value={discValue}
                      onChange={(e) => {
                        setDiscValue(e.target.value);
                        setDiscountFailure(null);
                      }}
                      disabled={busy}
                    />
                  </div>
                  {parsedDiscount.error && (
                    <p role="alert" className="text-[11px] text-terra">{parsedDiscount.error}</p>
                  )}
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
                    <Button size="sm" variant="outline" disabled={busy || parsedDiscount.value === null} onClick={applyDiscount}>
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

          {showNoShow && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label>Guest didn’t arrive</Label>
              {!confirmNoShow ? (
                <Button variant="outline" onClick={() => setConfirmNoShow(true)} disabled={busy}>
                  Mark as no-show
                </Button>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-cream-2/50 p-3">
                  <span className="text-sm text-muted">
                    Record that nobody arrived? These nights stop counting as occupied and the
                    unit is free to re-let.
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" onClick={() => setConfirmNoShow(false)} disabled={busy}>
                      Keep
                    </Button>
                    <Button variant="primary" onClick={doNoShow} disabled={busy}>
                      {busy && <Spinner className="text-white" />} No-show
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

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

/**
 * Tier 1 of the OTA contact-info plan. An imported Booking.com block has no real
 * guest attached — staff copy the guest's name/phone/email from the Booking.com
 * extranet or Pulse app into a contact (create one from Guests if new), pick it
 * here, and claim. The booking becomes CONFIRMED: it appears in today's arrivals,
 * can be checked in and invoiced, and the guest joins the CRM.
 */
function ClaimBookingSection({ reservationId, onClaimed }: { reservationId: string; onClaimed: () => void }) {
  const claim = useClaimOtaBooking();
  const [guest, setGuest] = useState<PickedGuest | null>(null);

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
      <Label>Claim this booking</Label>
      <p className="text-xs text-slate-500">
        Copy the guest&apos;s details from the Booking.com extranet/Pulse app into a contact (add one under
        Guests if they&apos;re new), then attach it here. The booking becomes a normal confirmed stay —
        arrivals, check-in, invoices, CRM.
      </p>
      <GuestPicker value={guest} onChange={setGuest} disabled={claim.isPending} />
      <Button
        variant="primary"
        className="self-start"
        disabled={!guest || claim.isPending}
        onClick={() => {
          if (!guest) return;
          claim.mutate(
            { id: reservationId, contactId: guest.id },
            { onSuccess: onClaimed },
          );
        }}
      >
        {claim.isPending && <Spinner className="text-white" />} Claim booking
      </Button>
    </div>
  );
}

/** Everything that has gone back to the guest on this booking: the credit notes. */
function refundedTotal(f: ReservationFolio): number {
  return f.invoices.filter((i) => i.kind === 'REFUND').reduce((sum, i) => sum + i.total_amount, 0);
}

/** Everything paid has gone back: agreed total P0 with a receipt and its credit note behind it. */
function fullyRefunded(f: ReservationFolio): boolean {
  return (
    f.total_amount === 0 &&
    f.total_source === 'FOLIO' &&
    f.invoices.some((i) => i.kind === 'REFUND' || i.status === 'REFUNDED')
  );
}

/**
 * (R8 #3, R9 #4) Refund straight from the booking. A cancelled booking still holding money
 * can't be removed ("refund it from the booking first"), but the booking had no refund button —
 * staff had to find the receipt on the Invoices page. Offered on any booking holding money.
 * It refunds the latest receipt with something left on it, capped at what is left there and
 * at what the booking holds; the server re-checks both under its locks.
 */
function RefundFromBooking({ folio, status }: { folio: ReservationFolio; status: Reservation['status'] }) {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const refund = useRefundInvoice();
  const closed = status === 'CANCELLED' || status === 'NO_SHOW';
  // (R9 #4) Any booking holding money can refund from here, up to what it holds — a refund
  // lowers the agreed total by the same amount, so it never puts the guest in debt (2026-10-02).
  const receipt = [...folio.invoices]
    .reverse()
    .find((i) => i.kind !== 'REFUND' && i.status === 'PAID' && i.total_amount - (i.refunded_amount ?? 0) > 0);
  const onReceipt = receipt ? Math.min(folio.paid_amount, receipt.total_amount - (receipt.refunded_amount ?? 0)) : 0;
  // (R10 #4) A stay shortened after payment can only hand back what was overpaid — the server
  // refuses more (it would eat into nights actually stayed). Say THAT limit, not the receipt's.
  const cap = !closed && folio.credit_amount > 0 ? Math.min(onReceipt, folio.credit_amount) : onReceipt;

  // (R10 #2) The box starts empty everywhere — a prefilled full amount on a cancelled booking was
  // one click from refunding all of it. The limit is right above it.
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // (R10 #1) Refunding a live stay down to P0 makes it free — asked first, here or by the server.
  const [askFull, setAskFull] = useState<string | null>(null);
  const key = useRef('');
  const inFlight = useRef(false);
  useEffect(() => {
    setAmount('');
    setReason('');
    setAskFull(null);
    key.current = newIdempotencyKey();
  }, [receipt?.id, cap]);

  if (!hasPerm('invoices.refund') || !receipt || cap <= 0) return null;

  const thebe = pulaToThebe(amount);
  const valid = !Number.isNaN(thebe) && thebe > 0 && thebe <= cap && reason.trim().length > 0;
  // Mirrors the server: what is left of the agreed total after this refund (only the part
  // beyond any overpayment lowers it).
  const makesFree =
    !closed && folio.total_amount > 0 && folio.total_amount - Math.max(0, thebe - (folio.credit_amount ?? 0)) <= 0;

  async function submit(confirmFullRefund = false) {
    if (!valid || !receipt || inFlight.current) return;
    if (makesFree && !confirmFullRefund) {
      setAskFull(
        'This refunds everything and makes the stay free — the guest keeps the unit and nothing more can be charged. Refund anyway? (To end the stay too, cancel the booking.)'
      );
      return;
    }
    inFlight.current = true;
    try {
      await refund.mutateAsync({
        id: receipt.id,
        amount: thebe,
        reason: reason.trim(),
        idempotencyKey: key.current,
        confirmFullRefund,
      });
      key.current = newIdempotencyKey();
      setAskFull(null);
    } catch (e) {
      // The server asks too (its figures may be newer than this screen's).
      const question = fullRefundMessage(e);
      if (question) setAskFull(question);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <Label className="text-[11px] uppercase tracking-[0.18em] text-muted">Refund</Label>
      <p className="text-xs text-muted">
        Refunds from receipt {receipt.number}. Up to {formatMoney(cap)} can go back from here
        {cap < onReceipt ? ' — what was paid beyond the shortened stay.' : '.'}
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="res-refund-amount">Refund amount (Pula)</Label>
        <Input
          id="res-refund-amount"
          inputMode="decimal"
          placeholder={`up to ${(cap / 100).toFixed(2)}`}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setAskFull(null);
          }}
        />
        <AmountError value={amount} positive />
        {!Number.isNaN(thebe) && thebe > cap && (
          <p className="text-[11px] text-terra">That is more than can be refunded from here.</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="res-refund-reason">Reason</Label>
        <Input
          id="res-refund-reason"
          placeholder="e.g. Cancelled within the free-cancellation period"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {askFull ? (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-terra/40 bg-terra/5 p-3">
          <p className="text-sm text-terra">{askFull}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={!valid || refund.isPending} onClick={() => submit(true)}>
              {refund.isPending ? <Spinner className="h-4 w-4" /> : `Yes — refund ${formatMoney(thebe)}`}
            </Button>
            <Button variant="ghost" disabled={refund.isPending} onClick={() => setAskFull(null)}>
              Don’t refund
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="outline" disabled={!valid || refund.isPending} onClick={() => submit()}>
            {refund.isPending ? <Spinner className="h-4 w-4" /> : `Refund ${formatMoney(Number.isNaN(thebe) ? 0 : thebe)}`}
          </Button>
        </div>
      )}
    </div>
  );
}

