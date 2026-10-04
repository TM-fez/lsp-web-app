import { ReservationsRepository } from './reservations.repository.js';
import { RoomsRepository } from '../rooms/rooms.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { logger } from '../../core/logger.js';
import { describeThebe, TERMINAL_RESERVATION_STATUSES } from '../../core/money/folio.js';
import { todayInPropertyTZ } from '../../core/time.js';
import { nightsBetween } from '../quotes/quotes.util.js';
import { buildReservationPricing, type ReservationPricing, type NotPriceable } from './reservations.pricing.js';
import type { UnitType } from '../pricing/pricing.types.js';
import type { ReservationRow, NewReservation, UpdateReservation } from '../../db/types.js';
import type {
  ReservationFilters, 
  ReservationPaginationOptions, 
  PaginatedReservationResult, 
  ReservationRequestMeta,
  CreateReservationDTO,
  UpdateReservationDTO,
  SetDiscountDTO,
  ClaimOtaBookingDTO,
  MarkPaidDTO,
  ConfirmReservationDTO,
  ReservationListRow,
  ReservationFolio
} from './reservations.types.js';

/**
 * True when an error is the `reservations_no_overlap` exclusion constraint firing —
 * i.e. two bookings raced past the availability pre-check and the database caught
 * the overlap. This is the storage-layer guarantee behind "no double-bookings, ever".
 */
export function isReservationOverlapError(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === '23P01' && err?.constraint === 'reservations_no_overlap';
}

export class ReservationsService {
  // rooms + pricing are optional so unit tests can construct the service with just
  // a repository; the live router (reservations.routes) always wires them in, which
  // is what GET /:id/pricing needs. payments is wired the same way and backs
  // POST /:id/mark-paid — see markPaid(). (quotes/holds/invoices used to be injected
  // here too, to be driven one transaction at a time; the desk payment is now ONE
  // transaction inside PaymentsRepository.recordDeskPayment, so they are gone.)
  constructor(
    private readonly repository: ReservationsRepository,
    private readonly rooms?: RoomsRepository,
    private readonly pricing?: PricingService,
    private readonly payments?: PaymentsService,
  ) {}

  /**
   * Price a booking and apply its (approved) discount — this is what turns a
   * recorded discount into a real amount due. Prices the room's stay off its
   * active rate plan, then discounts it the same way a quote discounts a stay.
   * Returns { priceable: false } when the room type has no active rate plan,
   * so the drawer degrades gracefully instead of erroring.
   */
  async priceReservation(id: string, activePropertyId?: string): Promise<ReservationPricing | NotPriceable> {
    const reservation = await this.getReservationById(id, activePropertyId);
    return this.priceStay(reservation, reservation);
  }

  /**
   * Price a stay shape (room + dates) at TODAY's rate card, carrying the booking's own
   * discount. Split out of priceReservation so an edit can price the stay as it WAS as
   * well as how it IS — see repriceAfterEdit.
   */
  private async priceStay(
    stay: Pick<ReservationRow, 'room_id' | 'check_in_date' | 'check_out_date'>,
    reservation: ReservationRow
  ): Promise<ReservationPricing | NotPriceable> {
    if (!this.rooms || !this.pricing) {
      throw AppError.internal('Pricing is not configured for this service');
    }
    const nights = nightsBetween(stay.check_in_date, stay.check_out_date);

    const room = await this.rooms.findById(stay.room_id);
    if (!room) return { priceable: false, reason: 'Unit not found', nights };

    let plan;
    try {
      plan = await this.pricing.getActivePlan(room.type as UnitType);
    } catch {
      return { priceable: false, reason: `No active rate plan for a ${room.type} unit`, nights };
    }

    const price = this.pricing.priceStay(plan, nights);
    return buildReservationPricing({
      currency: price.currency,
      nights,
      baseAmount: price.base_amount,
      taxRateBps: plan.tax_rate_bps,
      depositPct: plan.deposit_pct,
      discount:
        reservation.discount_value != null && reservation.discount_type != null
          ? {
              type: reservation.discount_type,
              value: reservation.discount_value,
              reason: reservation.discount_reason,
              approved: reservation.discount_approved_at != null,
            }
          : null,
    });
  }

  /**
   * The booking's MONEY axis (migration 067): what the stay costs, what has arrived,
   * what is still owed — all in integer thebe.
   *
   * Orthogonal to `status` by design. Nothing this method returns may be used to
   * decide whether the booking holds the room (invariant 7): an unpaid booking holds
   * it, and so does a part-paid one.
   *
   * The total prefers the FROZEN folio_total_amount, because rate plans have no
   * effective dating and re-pricing an old stay at today's rates would quietly
   * restate history. It falls back to live pricing only when nothing was ever frozen,
   * and says so via `total_source` so the UI can be honest about which it is showing.
   */
  async getFolio(id: string, activePropertyId?: string): Promise<ReservationFolio> {
    const reservation = await this.getReservationById(id, activePropertyId);

    let total = reservation.folio_total_amount;
    let source: ReservationFolio['total_source'] = 'FOLIO';
    let currency = reservation.folio_currency;

    if (total == null) {
      source = 'PRICED';
      const priced = await this.priceReservation(id, activePropertyId);
      // A stay whose room type has no active rate plan cannot be priced at all. Report
      // a zero total rather than throwing: the folio is also how staff SEE that a
      // booking has no price yet, and a 500 here would blank the whole drawer.
      total = 'priceable' in priced && priced.priceable === false ? 0 : priced.total_amount;
      if ('currency' in priced && priced.currency) currency = priced.currency;
    }

    const paid = (await this.repository.paidToDate([id])).get(id) ?? 0;
    const invoices = await this.repository.folioInvoices(id);

    // (Re-test 2026-10-04) A cancelled or no-show booking owes nothing — its open invoice
    // is voided (owner decision 2026-10-02 (b)) and Finance counts 0 — but the folio kept
    // reporting `total − paid` as a debt. The two now agree.
    const closed = (TERMINAL_RESERVATION_STATUSES as readonly string[]).includes(reservation.status);

    // Clamped at zero: an overpayment is not a negative debt. It IS money the guest is
    // owed back — a stay shortened after payment brought the agreed total under what was
    // paid, and the folio used to show a plain "PAID" with nothing to say a refund was
    // due. It is reported as `credit_amount`. (On a closed booking whether money paid is
    // returned is the cancellation terms' call, not arithmetic — no credit is implied.)
    const outstanding = closed ? 0 : Math.max(0, total - paid);
    const credit = closed ? 0 : Math.max(0, paid - total);

    return {
      reservation_id: id,
      currency,
      total_amount: total,
      paid_amount: paid,
      outstanding_amount: outstanding,
      credit_amount: credit,
      // A complimentary stay (agreed at P0 — e.g. a 100% discount) owes nothing and was
      // never going to be paid; calling it UNPAID sent staff looking for a missing invoice.
      payment_state:
        total === 0 && source === 'FOLIO' && outstanding === 0
          ? 'PAID'
          : paid <= 0 ? 'UNPAID' : outstanding > 0 ? 'PART_PAID' : 'PAID',
      total_source: source,
      invoices,
    };
  }

  /**
   * Record a payment taken off-system against a PENDING booking, so it reaches
   * CONFIRMED.
   *
   * Why this exists: a booking from the public site lands as a PENDING reservation
   * with NO quote, hold or payment intent behind it, and `settlePaid()` — the only
   * thing allowed to confirm a reservation — needs all three. Without this there is
   * no route from "the guest paid at reception" to a confirmed booking, and the
   * website-expiry sweep eventually cancels it. The cockpit's booking wizard cannot
   * help: it builds its own new reservation and can't adopt an existing one.
   *
   * So we assemble the same chain the wizard does (quote -> hold -> intent -> successful
   * attempt) against the booking that already exists — but ATOMICALLY: see
   * PaymentsRepository.recordDeskPayment. Nothing here bypasses the invariant;
   * settlePaid() still does the confirming.
   *
   * The amount defaults to what the booking still OWES per the folio — the frozen agreed
   * price (or, before one exists, the booking's own priced total with any approved
   * discount applied) minus what has already arrived.
   *
   * What the folio says is re-read UNDER THE BOOKING'S LOCK. This method used to read it
   * here, decide the cap, then create four rows in four transactions: two parallel
   * requests both saw "P4,500 outstanding" and both collected it. The checks below are only
   * the cheap early refusals with good messages; the authoritative ones are in the
   * repository, where they can't be raced.
   *
   * The receipt and the re-sized balance invoice are written in the same transaction as the
   * money — a payment can no longer exist without its invoice, and a part payment leaves
   * exactly one open invoice for what remains (invoices.receivable.ts).
   */
  async markPaid(
    id: string,
    dto: MarkPaidDTO,
    meta: ReservationRequestMeta,
    activePropertyId?: string,
  ): Promise<ReservationRow> {
    if (!this.rooms || !this.pricing || !this.payments) {
      throw AppError.internal('Payment recording is not configured for this service');
    }

    const reservation = await this.getReservationById(id, activePropertyId);
    // Money can arrive at any point in a live stay — including AFTER it, which is the
    // whole point of pay-later ("some clients pay after stay", owner 2026-09-07). This
    // used to demand PENDING, so the very guest the decoupling exists for could not be
    // recorded as paying: by the time they paid they were CHECKED_OUT.
    // A whitelist, so a new status must be considered rather than inheriting the right
    // to take money.
    const PAYABLE = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'];
    if (!PAYABLE.includes(reservation.status)) {
      throw AppError.conflict(
        reservation.status === 'BLOCKED'
          ? 'This is an imported Booking.com block — claim it to a guest before taking payment.'
          : `A ${reservation.status.toLowerCase().replace('_', ' ')} booking cannot take a payment.`,
      );
    }

    const room = await this.rooms.findById(reservation.room_id);
    if (!room) throw AppError.badRequest('This booking has no unit, so it cannot be priced or paid for.');

    const priced = await this.priceReservation(id, activePropertyId);
    if (!priced.priceable) {
      throw AppError.badRequest(`This booking cannot be priced: ${priced.reason}. Set a rate plan for the unit first.`);
    }

    // Early, friendly refusal against the folio (frozen agreed price minus what has
    // arrived). Capping against `priced.total_amount` (the whole stay, recomputed at
    // TODAY's rates) let a second payment be taken for the full amount on a booking that
    // was already part-paid, and moved with the rate plan besides.
    const paid = (await this.repository.paidToDate([id])).get(id) ?? 0;
    const total = reservation.folio_total_amount ?? priced.total_amount;
    const outstanding = Math.max(0, total - paid);
    const amount = dto.amount ?? outstanding;

    if (amount <= 0) {
      throw AppError.badRequest(
        outstanding <= 0 ? 'This booking is already paid in full.' : 'Enter how much the guest paid.',
      );
    }
    if (amount > outstanding) {
      throw AppError.badRequest(
        `That is more than this booking still owes. Outstanding: ${describeThebe(outstanding)}.`,
      );
    }

    await this.payments.recordDeskPayment(
      {
        reservationId: reservation.id,
        roomId: reservation.room_id,
        stay: {
          unit_type: room.type as UnitType,
          check_in: reservation.check_in_date,
          check_out: reservation.check_out_date,
          guests: 1,
        },
        pricedTotal: priced.total_amount,
        // Omitted when the caller didn't say: the repository then takes whatever is
        // outstanding AT THE MOMENT IT HOLDS THE LOCK, not what it was a moment ago.
        amount: dto.amount,
        method: dto.method,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
      },
      meta,
    );

    return this.getReservationById(id, activePropertyId);
  }

  /**
   * Record that a confirmed guest never arrived.
   *
   * Until this existed the booking stayed CONFIRMED for ever, and the occupancy
   * reports count nights whose status is in ('CONFIRMED','CHECKED_IN','CHECKED_OUT') —
   * so an empty unit was reported as occupied, including in occupancyByOwnedRoom,
   * which feeds owner statements. A landlord could be shown nights nobody slept.
   *
   * Cancelling instead would fix the arithmetic and lose the fact: a guest who
   * cancelled and a guest who simply did not turn up are different things to know
   * about an account, and only one of them is worth remembering next time they book.
   *
   * Marking it also releases the dates — checkAvailability excludes NO_SHOW and the
   * reservations_no_overlap constraint never covered it — so a stay abandoned halfway
   * frees its remaining nights for someone else.
   */
  /**
   * Confirm a stay with no money in hand.
   *
   * Why this exists (owner decision 2026-09-07, amending invariant 3): CONFIRMED used
   * to be reachable only through settlePaid(), so "the stay is on" and "the money
   * arrived" were the same fact. Some clients settle after the stay. Staff worked
   * around it by not booking at all — which is how a walk-in ends up with no record
   * anywhere, and how the room they are sleeping in reads as free.
   *
   * PENDING only. A booking that is already CONFIRMED or CHECKED_IN needs nothing from
   * this; a CANCELLED / CHECKED_OUT / NO_SHOW one is over, and BLOCKED belongs to the
   * Booking.com importer (claim it instead).
   *
   * Deliberately gated on reservations.update, NOT a new permission and NOT a payments
   * one. Reception already holds payments.create + payments.update (migration 064) and
   * could therefore already reach CONFIRMED by recording a P1 payment — a new gate
   * would be theatre. Migration 064's own argument applies verbatim: the audit trail is
   * the control, not the permission. `confirmed_without_payment` makes it greppable,
   * and the note says why.
   *
   * The agreed price is frozen here if it was not already, because this is the moment
   * the stay is agreed. Leaving it NULL would let a later rate change silently restate
   * what this guest owes — see migration 067.
   */
  async confirmWithoutPayment(
    id: string,
    dto: ConfirmReservationDTO,
    meta: ReservationRequestMeta,
    activePropertyId?: string
  ): Promise<ReservationRow> {
    const reservation = await this.getReservationById(id, activePropertyId);

    if (reservation.status !== 'PENDING') {
      const already = reservation.status === 'CONFIRMED' || reservation.status === 'CHECKED_IN';
      throw AppError.conflict(
        reservation.status === 'BLOCKED'
          ? 'This is an imported Booking.com block — claim it to a guest instead of confirming it.'
          : already
            ? `This booking is already ${reservation.status.toLowerCase().replace('_', ' ')}.`
            : `A ${reservation.status.toLowerCase().replace('_', ' ')} booking cannot be confirmed.`
      );
    }

    // Freeze the agreed price if nothing has yet. Best-effort: a room type with no
    // active rate plan is not a reason to refuse the confirmation — staff can still
    // vouch for a stay they have not priced, and the folio falls back to live pricing
    // and says so. Better an unpriced confirmed booking than an unrecorded guest.
    let folioTotal: number | null = reservation.folio_total_amount;
    let taxRateBps: number | undefined;
    let currency: string | undefined;
    try {
      const priced = await this.priceReservation(id, activePropertyId);
      if (priced.priceable) {
        taxRateBps = priced.tax_rate_bps;
        currency = priced.currency;
        if (folioTotal == null) folioTotal = priced.total_amount;
      }
    } catch (err) {
      logger.warn({ err, reservationId: id }, '[reservations] confirmed without a priced folio');
    }

    const updated = await this.repository.update(
      id,
      {
        status: 'CONFIRMED',
        confirmed_at: new Date(),
        confirmed_by: meta.userId,
        confirmed_without_payment: true,
        confirmation_note: dto.note ?? null,
        ...(folioTotal != null ? { folio_total_amount: folioTotal } : {}),
        ...(folioTotal != null && currency ? { folio_currency: currency } : {}),
        updated_by: meta.userId,
      },
      meta,
      undefined,
      // The stay is on and nothing is paid: that is a receivable. Raise the invoice in the
      // same transaction as the confirmation, or Finance has no idea this guest owes.
      { reconcile: true, taxRateBps }
    );
    if (!updated) throw AppError.notFound(`Reservation with id ${id} not found`);
    return updated;
  }

  /**
   * Make sure a live booking's price is agreed and its receivable is on the books.
   *
   * Called by the flows that create money OWED without any money arriving: a public website
   * booking, check-in, check-out. Without it the stay exists and the debt does not — no
   * invoice, so nothing in Finance, nothing to chase. Idempotent (a second call finds the
   * invoice already right and changes nothing), so it is safe to call from several places.
   *
   * Never throws for want of a rate plan: an unpriceable booking simply has no receivable
   * yet, which is the truth.
   */
  async ensureReceivable(id: string, meta: ReservationRequestMeta): Promise<void> {
    if (!this.pricing || !this.rooms) return;
    const priced = await this.priceReservation(id);
    await this.repository.agreePrice(
      id,
      priced.priceable
        ? { total: priced.total_amount, currency: priced.currency, taxRateBps: priced.tax_rate_bps }
        : null,
      meta,
      'ensure'
    );
  }

  /**
   * After an edit that changes the price (dates, unit, discount) of a booking that was
   * priced at creation and has had no money, move the frozen price and its invoice to the
   * new figure. A no-op for anything else — see ReservationsRepository.agreePrice. Failure
   * is logged, not thrown: the edit has committed and the receivable self-heals on the next
   * touch (and the backfill reconciles any drift).
   */
  private async refreezeIfUnpaid(id: string, meta: ReservationRequestMeta): Promise<void> {
    if (!this.pricing || !this.rooms) return;
    try {
      const current = await this.repository.findById(id);
      if (!current || current.status !== 'PENDING' || current.folio_total_amount == null) return;
      const priced = await this.priceReservation(id);
      if (!priced.priceable) return;
      await this.repository.agreePrice(
        id,
        { total: priced.total_amount, currency: priced.currency, taxRateBps: priced.tax_rate_bps },
        meta,
        'refreeze'
      );
    } catch (err) {
      logger.error({ err, reservationId: id }, '[reservations] could not re-price the receivable after an edit');
    }
  }

  /**
   * (Stage 3) After a date or unit change, move what the booking owes.
   *
   * An unpaid PENDING booking is simply re-priced (refreezeIfUnpaid) — nothing about it
   * has been agreed with money yet. Every other live booking — CONFIRMED (paid or
   * confirmed without payment, invariant 3), part-paid, CHECKED_IN — used to keep its old
   * price: extend a confirmed stay by three nights and the folio, the invoice and Finance
   * still said the original amount.
   *
   * For those the agreed price moves by the DIFFERENCE between the stay as it was and as
   * it is, both priced at today's rates. Re-pricing the whole stay would restate nights
   * the guest already agreed (a negotiated rate, an older rate card — CLAUDE.md: never
   * size money from a re-priced total); the delta keeps them and adds or removes only
   * what changed. A shortened, already-paid stay can end up overpaid — the reconcile
   * then owes nothing and the backfill lists it; a refund stays a human decision.
   *
   * Failure is logged, not thrown: the edit has committed, and the receivable self-heals
   * on the next touch.
   */
  private async repriceAfterEdit(before: ReservationRow, after: ReservationRow, meta: ReservationRequestMeta): Promise<void> {
    if (!this.pricing || !this.rooms) return;
    try {
      // `before` / `after` are this edit's own two sides (read under the row lock by
      // repository.update) — not a fresh read, which a concurrent edit may have moved.
      if (after.folio_total_amount == null) return;
      if (!['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(after.status)) return;

      const paid = (await this.repository.paidToDate([after.id])).get(after.id) ?? 0;
      if (after.status === 'PENDING' && paid === 0) {
        await this.refreezeIfUnpaid(after.id, meta);
        return;
      }

      const [was, now] = await Promise.all([this.priceStay(before, after), this.priceStay(after, after)]);
      if (!was.priceable || !now.priceable) return;
      const delta = now.total_amount - was.total_amount;
      if (delta === 0) return;

      await this.repository.agreePrice(
        after.id,
        {
          total: Math.max(0, after.folio_total_amount + delta),
          delta,
          currency: now.currency,
          taxRateBps: now.tax_rate_bps,
        },
        meta,
        'adjust'
      );
    } catch (err) {
      logger.error({ err, reservationId: before.id }, '[reservations] could not re-price the receivable after an edit');
    }
  }

  async markNoShow(id: string, meta: ReservationRequestMeta, activePropertyId?: string): Promise<ReservationRow> {
    const reservation = await this.getReservationById(id, activePropertyId);

    if (reservation.status !== 'CONFIRMED') {
      throw AppError.conflict(
        `Only a confirmed booking can be marked a no-show — this one is ${reservation.status.toLowerCase().replace('_', ' ')}.`,
      );
    }

    // The arrival day must have passed in the PROPERTY's timezone. Marking someone a
    // no-show on the morning they are due is a mistake, not a judgement call.
    const checkIn = new Date(reservation.check_in_date).toISOString().slice(0, 10);
    if (checkIn >= todayInPropertyTZ()) {
      throw AppError.badRequest('This guest is not due to arrive until today or later, so they cannot be a no-show yet.');
    }

    const updated = await this.repository.update(id, { status: 'NO_SHOW', updated_by: meta.userId }, meta);
    if (!updated) throw AppError.notFound(`Reservation with id ${id} not found`);
    return updated;
  }

  async getReservationById(id: string, activePropertyId?: string): Promise<ReservationRow> {
    const reservation = await this.repository.findById(id);
    if (!reservation) {
      throw AppError.notFound(`Reservation with id ${id} not found`);
    }
    // Property scope: a reservation outside the caller's active property is
    // treated as "not found" so its existence doesn't leak across properties.
    // This is the single chokepoint every by-id operation flows through.
    if (activePropertyId) {
      const pid = await this.repository.roomPropertyId(reservation.room_id);
      if (pid !== activePropertyId) {
        throw AppError.notFound(`Reservation with id ${id} not found`);
      }
    }
    return reservation;
  }

  async getReservations(
    filters: ReservationFilters,
    pagination: ReservationPaginationOptions
  ): Promise<PaginatedReservationResult<ReservationListRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async checkAvailability(roomId: string, checkIn: Date, checkOut: Date, excludeId?: string): Promise<boolean> {
    return this.repository.checkAvailability(roomId, checkIn, checkOut, excludeId);
  }

  /** The optional CRM contacts (A4) must be real, non-deleted contacts — a bad id
   *  becomes a clean 400 instead of an FK-violation 500. */
  private async assertCrmContactsExist(dto: { booking_coordinator_id?: string | null; billing_contact_id?: string | null }): Promise<void> {
    if (dto.booking_coordinator_id && !(await this.repository.contactExists(dto.booking_coordinator_id))) {
      throw AppError.badRequest('Booking coordinator must be an existing contact');
    }
    if (dto.billing_contact_id && !(await this.repository.contactExists(dto.billing_contact_id))) {
      throw AppError.badRequest('Billing contact must be an existing contact');
    }
  }

  async createReservation(dto: CreateReservationDTO, meta: ReservationRequestMeta, activePropertyId?: string): Promise<ReservationRow> {
    await this.assertCrmContactsExist(dto);
    const checkIn = new Date(dto.check_in_date);
    const checkOut = new Date(dto.check_out_date);

    // Reject check-in dates before "today" in the property's timezone (Africa/Gaborone),
    // so a booking made just after midnight in Gaborone isn't judged against the server's UTC day.
    if (checkIn.toISOString().slice(0, 10) < todayInPropertyTZ()) {
      throw AppError.badRequest('Cannot create reservation with check-in date in the past');
    }

    // Property scope: the chosen unit must belong to the active property.
    if (activePropertyId) {
      const roomProperty = await this.repository.roomPropertyId(dto.room_id);
      if (roomProperty !== activePropertyId) {
        throw AppError.badRequest('That unit is not in your active property');
      }
    }

    // Check availability
    const isAvailable = await this.checkAvailability(dto.room_id, checkIn, checkOut);
    if (!isAvailable) {
      throw AppError.conflict('Room is not available for the selected dates');
    }

    const newReservation: NewReservation = {
      ...dto,
      status: 'PENDING', // commercial invariant: new reservations are always PENDING; only settlePaid() confirms
      created_by: meta.userId,
      updated_by: meta.userId,
    };
    try {
      return await this.repository.create(newReservation, meta);
    } catch (e) {
      // Race backstop: another booking took these dates between the pre-check
      // above and this insert. The DB constraint caught it — surface a clean 409.
      if (isReservationOverlapError(e)) {
        throw AppError.conflict('Room is not available for the selected dates');
      }
      throw e;
    }
  }

  async modifyReservation(id: string, dto: UpdateReservationDTO, meta: ReservationRequestMeta, activePropertyId?: string): Promise<ReservationRow> {
    await this.assertCrmContactsExist(dto);
    const existing = await this.getReservationById(id, activePropertyId);

    // If the booking is being moved to a different unit, that unit must also be in
    // the active property.
    if (activePropertyId && dto.room_id) {
      const roomProperty = await this.repository.roomPropertyId(dto.room_id);
      if (roomProperty !== activePropertyId) {
        throw AppError.badRequest('That unit is not in your active property');
      }
    }

    // Commercial invariant: CONFIRMED / CHECKED_IN / CHECKED_OUT are owned by the
    // system (payment via settlePaid(), and the check-in flow) — never set by a
    // direct edit. This keeps settlePaid() the sole commercial confirmer.
    if (dto.status && ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'].includes(dto.status)) {
      throw AppError.badRequest(
        `Reservation status '${dto.status}' is set by the system (payment / check-in), not by direct edit`
      );
    }

    // NO_SHOW carries its own preconditions (confirmed, arrival day passed, never
    // checked in) — see markNoShow. Reaching it through a plain edit would skip them.
    if (dto.status === 'NO_SHOW') {
      throw AppError.badRequest('Use the no-show action on the booking to record that a guest did not arrive.');
    }

    // Status transitions enforced
    if (dto.status && existing.status === 'CANCELLED' && dto.status !== 'CANCELLED') {
      throw AppError.conflict('Cannot modify a cancelled reservation');
    }
    if (dto.status && existing.status === 'CHECKED_OUT' && dto.status !== 'CHECKED_OUT') {
      throw AppError.conflict('Cannot modify a checked out reservation');
    }

    const checkIn = dto.check_in_date ? new Date(dto.check_in_date) : existing.check_in_date;
    const checkOut = dto.check_out_date ? new Date(dto.check_out_date) : existing.check_out_date;
    const roomId = dto.room_id || existing.room_id;

    if (checkIn >= checkOut) {
      throw AppError.badRequest('Check-out date must be after check-in date');
    }

    // Re-check availability if dates or room changed
    if (dto.check_in_date || dto.check_out_date || dto.room_id) {
      const isAvailable = await this.checkAvailability(roomId, checkIn, checkOut, id);
      if (!isAvailable) {
        throw AppError.conflict('Room is not available for the updated dates/room');
      }
    }
    
    const updatePayload: UpdateReservation = {
      ...dto,
      updated_by: meta.userId,
    };
    
    // Moving an IN-HOUSE guest has to carry the occupancy row and both units' statuses
    // with it, or the cockpit contradicts itself: its in-house/departures cards join
    // rooms through OCCUPANCY (which was never updated) while the unit tiles join
    // through the reservation (which was). The repository does all of it inside the one
    // transaction the reservation update already opened.
    const movingInHouse =
      existing.status === 'CHECKED_IN' && !!dto.room_id && dto.room_id !== existing.room_id;

    let updated: ReservationRow | undefined;
    const capture: { before?: ReservationRow } = {};
    try {
      updated = await this.repository.update(
        id,
        updatePayload,
        meta,
        movingInHouse ? { fromRoomId: existing.room_id, toRoomId: roomId } : undefined,
        { capture }
      );
    } catch (e) {
      if (isReservationOverlapError(e)) {
        throw AppError.conflict('Room is not available for the updated dates/room');
      }
      throw e;
    }
    if (!updated) {
      throw AppError.notFound(`Failed to update reservation with id ${id}`);
    }
    if (dto.check_in_date || dto.check_out_date || dto.room_id) {
      await this.repriceAfterEdit(capture.before ?? existing, updated, meta);
    }
    return updated;
  }

  /**
   * Apply (request) a discount on a PENDING booking. If the actor can approve
   * (Tameem/admin), it's signed off immediately; otherwise it waits for approval.
   */
  async setDiscount(id: string, dto: SetDiscountDTO, meta: ReservationRequestMeta, canApprove: boolean, activePropertyId?: string): Promise<ReservationRow> {
    const existing = await this.getReservationById(id, activePropertyId);
    if (existing.status !== 'PENDING') {
      throw AppError.conflict('A discount can only be applied to a pending booking (before payment confirms it)');
    }
    const updated = await this.repository.update(id, {
      discount_type: dto.discount_type,
      discount_value: dto.discount_value,
      discount_reason: dto.discount_reason ?? null,
      discount_requested_by: meta.userId,
      discount_approved_by: canApprove ? meta.userId : null,
      discount_approved_at: canApprove ? new Date() : null,
      updated_by: meta.userId,
    }, meta);
    if (!updated) throw AppError.notFound(`Reservation ${id} not found`);
    await this.refreezeIfUnpaid(id, meta);
    return updated;
  }

  /** Manager sign-off on a pending discount. */
  async approveDiscount(id: string, meta: ReservationRequestMeta, activePropertyId?: string): Promise<ReservationRow> {
    const existing = await this.getReservationById(id, activePropertyId);
    if (existing.discount_value == null) throw AppError.notFound('There is no discount to approve on this booking');
    if (existing.discount_approved_at) throw AppError.conflict('This discount has already been approved');
    const updated = await this.repository.update(id, {
      discount_approved_by: meta.userId,
      discount_approved_at: new Date(),
      updated_by: meta.userId,
    }, meta);
    if (!updated) throw AppError.notFound(`Reservation ${id} not found`);
    await this.refreezeIfUnpaid(id, meta);
    return updated;
  }

  async removeDiscount(id: string, meta: ReservationRequestMeta, activePropertyId?: string): Promise<ReservationRow> {
    await this.getReservationById(id, activePropertyId);
    const updated = await this.repository.update(id, {
      discount_type: null,
      discount_value: null,
      discount_reason: null,
      discount_requested_by: null,
      discount_approved_by: null,
      discount_approved_at: null,
      updated_by: meta.userId,
    }, meta);
    if (!updated) throw AppError.notFound(`Reservation ${id} not found`);
    await this.refreezeIfUnpaid(id, meta);
    return updated;
  }

  /**
   * Tier 1 of the OTA contact-info plan: attach a REAL guest contact to an imported
   * Booking.com block and promote it into the normal reservation lifecycle
   * (arrivals rail, check-in, invoicing, CRM).
   *
   * This is the SECOND sanctioned writer of CONFIRMED — the first is settlePaid().
   * The commercial invariant ("confirmed only once the money is settled") holds:
   * an OTA booking's payment is already guaranteed on the OTA's side, so there is
   * nothing for LSP to collect before confirming. Source stays BOOKING_COM, so the
   * export feed keeps excluding it (no feedback loop), and the importer treats it
   * as claimed from here on: the feed may still move its dates, but status,
   * contact, and notes are staff-owned.
   */
  async claimOtaBooking(
    id: string,
    dto: ClaimOtaBookingDTO,
    meta: ReservationRequestMeta,
    activePropertyId?: string,
  ): Promise<ReservationRow> {
    const existing = await this.getReservationById(id, activePropertyId);

    if (existing.source !== 'BOOKING_COM' || existing.status !== 'BLOCKED') {
      throw AppError.conflict('Only an unclaimed Booking.com block can be claimed');
    }
    if (!(await this.repository.contactExists(dto.contact_id))) {
      throw AppError.badRequest('Contact not found');
    }

    const updated = await this.repository.update(
      id,
      { contact_id: dto.contact_id, status: 'CONFIRMED', updated_by: meta.userId },
      meta,
    );
    if (!updated) throw AppError.notFound(`Failed to claim reservation with id ${id}`);
    return updated;
  }

  async cancelReservation(id: string, meta: ReservationRequestMeta, activePropertyId?: string): Promise<ReservationRow> {
    const existing = await this.getReservationById(id, activePropertyId);

    if (['CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'].includes(existing.status)) {
      throw AppError.conflict(`Cannot cancel reservation with status ${existing.status}`);
    }

    const updated = await this.repository.update(
      id,
      { status: 'CANCELLED', updated_by: meta.userId },
      meta
    );

    if (!updated) {
      throw AppError.notFound(`Failed to cancel reservation with id ${id}`);
    }
    return updated;
  }

  /**
   * Permanently remove a cancelled booking from the lists (soft-delete: the row is
   * retained for audit, but hidden everywhere). Restricted to CANCELLED so a live
   * booking — one still holding a unit or already checked in — can never be erased;
   * cancel it first (which frees the unit), then remove it.
   */
  async removeReservation(id: string, meta: ReservationRequestMeta, activePropertyId?: string): Promise<void> {
    const existing = await this.getReservationById(id, activePropertyId);

    if (existing.status !== 'CANCELLED') {
      throw AppError.conflict(
        'Only a cancelled reservation can be removed. Cancel it first to free the unit, then remove it from the list.',
      );
    }

    const ok = await this.repository.softDelete(id, meta);
    if (!ok) {
      throw AppError.notFound(`Failed to remove reservation with id ${id}`);
    }
  }
}
