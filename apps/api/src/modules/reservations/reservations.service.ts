import { ReservationsRepository } from './reservations.repository.js';
import { RoomsRepository } from '../rooms/rooms.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { HoldsService } from '../holds/holds.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { logger } from '../../core/logger.js';
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
  // is what GET /:id/pricing needs. quotes/holds/payments are wired the same way and
  // back POST /:id/mark-paid — see markPaid().
  constructor(
    private readonly repository: ReservationsRepository,
    private readonly rooms?: RoomsRepository,
    private readonly pricing?: PricingService,
    private readonly quotes?: QuotesService,
    private readonly holds?: HoldsService,
    private readonly payments?: PaymentsService,
    private readonly invoices?: InvoicesService,
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
    if (!this.rooms || !this.pricing) {
      throw AppError.internal('Pricing is not configured for this service');
    }
    const nights = nightsBetween(reservation.check_in_date, reservation.check_out_date);

    const room = await this.rooms.findById(reservation.room_id);
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

    // Clamped at zero: an overpayment is a refund waiting to happen, not a negative
    // debt. The invoice lines below still show the full story.
    const outstanding = Math.max(0, total - paid);

    return {
      reservation_id: id,
      currency,
      total_amount: total,
      paid_amount: paid,
      outstanding_amount: outstanding,
      payment_state: paid <= 0 ? 'UNPAID' : outstanding > 0 ? 'PART_PAID' : 'PAID',
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
   * So we assemble the same chain the wizard does, in the same order, against the
   * booking that already exists: quote -> hold -> intent -> successful attempt.
   * Nothing here bypasses the invariant; settlePaid() still does the confirming.
   *
   * The amount defaults to the booking's OWN priced total, which has any approved
   * discount already applied — so an approved discount reduces what is actually
   * charged here, not merely what is displayed.
   *
   * A paid-up invoice is raised at the end so the guest has a receipt and Accounts has
   * a record, plus an UNPAID one for anything still owed. That step is deliberately
   * best-effort — see the comment at the call.
   */
  async markPaid(
    id: string,
    dto: MarkPaidDTO,
    meta: ReservationRequestMeta,
    activePropertyId?: string,
  ): Promise<ReservationRow> {
    if (!this.rooms || !this.pricing || !this.quotes || !this.holds || !this.payments) {
      throw AppError.internal('Payment recording is not configured for this service');
    }

    const reservation = await this.getReservationById(id, activePropertyId);
    if (reservation.status !== 'PENDING') {
      throw AppError.conflict(
        `Only a pending booking can be marked paid — this one is already ${reservation.status.toLowerCase().replace('_', ' ')}.`,
      );
    }

    const room = await this.rooms.findById(reservation.room_id);
    if (!room) throw AppError.badRequest('This booking has no unit, so it cannot be priced or paid for.');

    const priced = await this.priceReservation(id, activePropertyId);
    if (!priced.priceable) {
      throw AppError.badRequest(`This booking cannot be priced: ${priced.reason}. Set a rate plan for the unit first.`);
    }

    const amount = dto.amount ?? priced.total_amount;
    if (amount > priced.total_amount) {
      throw AppError.badRequest('The amount paid cannot be more than the total due for this booking.');
    }

    const quote = await this.quotes.createQuote(
      {
        unit_type: room.type as UnitType,
        check_in: reservation.check_in_date,
        check_out: reservation.check_out_date,
        guests: 1,
      },
      meta,
    );

    const hold = await this.holds.createHold(
      { quote_id: quote.id, room_id: reservation.room_id, reservation_id: reservation.id },
      meta,
    );

    const intent = await this.payments.createIntent(
      {
        hold_id: hold.id,
        method: dto.method,
        // Label only — the amount is explicit either way. BALANCE reads correctly for
        // a payment that settles the whole booking, DEPOSIT for a part payment.
        purpose: amount >= priced.total_amount ? 'BALANCE' : 'DEPOSIT',
        amount,
      },
      meta,
    );

    // SUCCESS runs settlePaid(): intent PAID, hold CONFIRMED, reservation CONFIRMED,
    // all in one transaction with its audit rows.
    await this.payments.attempt(
      intent.id,
      { outcome: 'SUCCESS', reference: dto.reference ?? null, note: dto.note ?? null },
      meta,
    );

    // Raise the receipt. Money has changed hands and the booking is already CONFIRMED
    // by the time we get here, so a failure to write the DOCUMENT must not fail the
    // request — telling reception "payment failed" after the guest has paid would send
    // them round again and risk taking the money twice. The quote and hold both exist
    // now, so Accounts can raise it by hand from the Invoices screen if this misses;
    // the error is logged loudly rather than swallowed.
    if (this.invoices) {
      try {
        await this.invoices.issueSettledInvoice(
          {
            quote_id: quote.id,
            hold_id: hold.id,
            reservation_id: reservation.id,
            kind: amount >= priced.total_amount ? 'BALANCE' : 'DEPOSIT',
            amount,
          },
          meta,
        );

        // Part payment: invoice what is STILL OWED, unpaid.
        //
        // Without this the money simply disappears from view — reception takes P500
        // against a P4,500 stay, the guest gets a P500 receipt, the booking confirms,
        // and nothing anywhere records the P4,000 outstanding. It would not appear in
        // the Finance cockpit's total, its ageing, or the property receivables, because
        // all three read OPEN invoices and no open invoice would exist.
        //
        // ISSUED, not settled: this is the one the guest still has to pay, and Accounts
        // settles it when they do.
        const outstanding = priced.total_amount - amount;
        if (outstanding > 0) {
          await this.invoices.issueInvoice(
            {
              quote_id: quote.id,
              hold_id: hold.id,
              reservation_id: reservation.id,
              kind: 'BALANCE',
              amount: outstanding,
            },
            meta,
          );
        }
      } catch (err) {
        logger.error(
          { err, reservationId: id, quoteId: quote.id, amount },
          '[reservations] payment recorded but its invoices could not be raised — raise them by hand from Invoices',
        );
      }
    }

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
    if (folioTotal == null) {
      try {
        const priced = await this.priceReservation(id, activePropertyId);
        if (!('priceable' in priced) || priced.priceable !== false) {
          folioTotal = priced.total_amount;
        }
      } catch (err) {
        logger.warn({ err, reservationId: id }, '[reservations] confirmed without a priced folio');
      }
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
        updated_by: meta.userId,
      },
      meta
    );
    if (!updated) throw AppError.notFound(`Reservation with id ${id} not found`);
    return updated;
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
    try {
      updated = await this.repository.update(
        id,
        updatePayload,
        meta,
        movingInHouse ? { fromRoomId: existing.room_id, toRoomId: roomId } : undefined
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
