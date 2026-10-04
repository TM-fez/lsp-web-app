import { releaseReservationHolds } from '../holds/holds.release.js';
import { Kysely, Transaction, sql } from 'kysely';
import type { Database, ReservationRow, NewReservation, UpdateReservation } from '../../db/types.js';
import { AppError } from '../../core/errors/AppError.js';
import { describeThebe } from '../../core/money/folio.js';
import type { ReservationPricing, NotPriceable } from './reservations.pricing.js';
import { paidToDate, lockReservation, TERMINAL_RESERVATION_STATUSES } from '../../core/money/folio.js';
import { inTransaction } from '../../core/db/transaction.js';
import { reconcileReceivable } from '../invoices/invoices.receivable.js';
import { HousekeepingRepository } from '../housekeeping/housekeeping.repository.js';
import type { ReservationFilters, ReservationPaginationOptions, PaginatedReservationResult, ReservationRequestMeta, ReservationListRow, FolioInvoiceLine } from './reservations.types.js';

/**
 * Prices a stay INSIDE the caller's transaction. The repository does not know about rate
 * plans; the service hands it this. It must read through the `trx` it is given — a second
 * pool connection taken while the booking's lock is held is how a busy pool deadlocks itself.
 */
export type StayPricer = (
  trx: Transaction<Database>,
  stay: Pick<ReservationRow, 'room_id' | 'check_in_date' | 'check_out_date'>,
  reservation: ReservationRow
) => Promise<ReservationPricing | NotPriceable>;

/** Everything `update` can do besides the plain column update, all under the booking's lock. */
export interface ReservationUpdateOptions {
  reconcile?: boolean;
  taxRateBps?: number;
  /** Runs on the row as it is UNDER THE LOCK, before anything is written; throw to refuse. */
  validate?: (current: ReservationRow) => void;
  /**
   * A date / unit change: move what the booking owes by (new stay − old stay), in this same
   * transaction. See repriceStayChange.
   */
  repriceStay?: StayPricer;
  /**
   * A discount change: re-agree the price of an unpaid PENDING booking from the row as it now
   * is, in this same transaction. See refreezeUnpaid.
   */
  refreeze?: StayPricer;
}

export class ReservationsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<ReservationRow | undefined> {
    return this.db
      .selectFrom('reservations')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * How much money has actually arrived against a booking, in thebe — the folio's
   * "paid". The arithmetic (including the refund subtlety) lives in core/money/folio.ts so
   * the payment, settle, refund and reconcile paths, which need the SAME answer inside
   * their own transactions, share one definition instead of copying it. See there.
   */
  async paidToDate(reservationIds: string[]): Promise<Map<string, number>> {
    return paidToDate(this.db, reservationIds);
  }

  /** The invoice documents behind a booking's folio, newest last. */
  async folioInvoices(reservationId: string): Promise<FolioInvoiceLine[]> {
    return this.db
      .selectFrom('invoices')
      .select(['id', 'number', 'kind', 'status', 'total_amount', 'created_at'])
      .where('reservation_id', '=', reservationId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'asc')
      .execute();
  }

  /**
   * The property a room belongs to (room → building → property), or null.
   *
   * `includeDeleted` is for a booking's OWN room: a unit that was soft-deleted after it was
   * booked is still where that booking is. Without it the property scope guard answered null,
   * every by-id read of the booking became "not found", and it vanished from the board.
   */
  async roomPropertyId(roomId: string, opts: { includeDeleted?: boolean } = {}): Promise<string | null> {
    let q = this.db
      .selectFrom('rooms')
      .leftJoin('buildings', 'buildings.id', 'rooms.building_id')
      .select('buildings.property_id as property_id')
      .where('rooms.id', '=', roomId);
    if (!opts.includeDeleted) q = q.where('rooms.deleted_at', 'is', null);
    const row = await q.executeTakeFirst();
    return row?.property_id ?? null;
  }

  async checkAvailability(roomId: string, checkIn: Date, checkOut: Date, excludeReservationId?: string): Promise<boolean> {
    // Rooms are the source of truth: a room must exist, be active, and not be
    // blocked by status (MAINTENANCE / OUT_OF_SERVICE) to accept reservations.
    const room = await this.db
      .selectFrom('rooms')
      .select('status')
      .where('id', '=', roomId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!room || room.status === 'MAINTENANCE' || room.status === 'OUT_OF_SERVICE') {
      return false;
    }

    // Check for overlaps: NewCheckIn < ExistCheckOut AND NewCheckOut > ExistCheckIn
    let query = this.db
      .selectFrom('reservations')
      .select(this.db.fn.count<number>('id').as('overlap_count'))
      .where('room_id', '=', roomId)
      .where('deleted_at', 'is', null)
      // A blacklist, unlike every other status filter in the app — so each new status
      // holds the dates unless named here. A no-show never turned up: the nights are
      // free and must be re-lettable.
      .where('status', 'not in', ['CANCELLED', 'CHECKED_OUT', 'NO_SHOW'])
      .where('check_in_date', '<', checkOut)
      .where('check_out_date', '>', checkIn);

    if (excludeReservationId) {
      query = query.where('id', '!=', excludeReservationId);
    }

    const { overlap_count } = await query.executeTakeFirstOrThrow();
    return Number(overlap_count) === 0;
  }

  async findPaginated(
    filters: ReservationFilters,
    pagination: ReservationPaginationOptions
  ): Promise<PaginatedReservationResult<ReservationListRow>> {
    // LEFT JOIN guest + room so list rows carry display names (never bare UUIDs)
    // and can be searched by guest name / room code. LEFT (not INNER) keeps a
    // reservation visible even if its contact or room was later soft-deleted.
    let query = this.db
      .selectFrom('reservations')
      .leftJoin('contacts', 'contacts.id', 'reservations.contact_id')
      .leftJoin('contacts as coordinator', 'coordinator.id', 'reservations.booking_coordinator_id')
      .leftJoin('contacts as biller', 'biller.id', 'reservations.billing_contact_id')
      .leftJoin('rooms', 'rooms.id', 'reservations.room_id')
      .leftJoin('buildings', 'buildings.id', 'rooms.building_id')
      .leftJoin('properties', 'properties.id', 'buildings.property_id')
      .selectAll('reservations')
      .select([
        'contacts.name as guest_name',
        'coordinator.name as booking_coordinator_name',
        'biller.name as billing_contact_name',
        'rooms.code as room_code',
        'rooms.name as room_name',
        'properties.id as property_id',
        'properties.name as property_name',
      ])
      .where('reservations.deleted_at', 'is', null);

    let countQuery = this.db
      .selectFrom('reservations')
      .leftJoin('contacts', 'contacts.id', 'reservations.contact_id')
      .leftJoin('rooms', 'rooms.id', 'reservations.room_id')
      .leftJoin('buildings', 'buildings.id', 'rooms.building_id')
      .select(this.db.fn.count<number>('reservations.id').as('total'))
      .where('reservations.deleted_at', 'is', null);

    if (filters.status) {
      query = query.where('reservations.status', '=', filters.status);
      countQuery = countQuery.where('reservations.status', '=', filters.status);
    }

    if (filters.source) {
      query = query.where('reservations.source', '=', filters.source);
      countQuery = countQuery.where('reservations.source', '=', filters.source);
    }

    if (filters.room_id) {
      query = query.where('reservations.room_id', '=', filters.room_id);
      countQuery = countQuery.where('reservations.room_id', '=', filters.room_id);
    }

    if (filters.contact_id) {
      query = query.where('reservations.contact_id', '=', filters.contact_id);
      countQuery = countQuery.where('reservations.contact_id', '=', filters.contact_id);
    }

    if (filters.property_id) {
      query = query.where('buildings.property_id', '=', filters.property_id);
      countQuery = countQuery.where('buildings.property_id', '=', filters.property_id);
    }

    if (filters.search) {
      const pat = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('reservations.notes', 'ilike', pat),
          eb('contacts.name', 'ilike', pat),
          eb('rooms.code', 'ilike', pat),
          eb('rooms.name', 'ilike', pat),
        ]),
      );
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('reservations.notes', 'ilike', pat),
          eb('contacts.name', 'ilike', pat),
          eb('rooms.code', 'ilike', pat),
          eb('rooms.name', 'ilike', pat),
        ]),
      );
    }

    const offset = (pagination.page - 1) * pagination.limit;

    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('reservations.created_at', 'desc').execute(),
      countQuery.execute(),
    ]);

    return {
      data,
      total: Number(total),
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async create(reservation: NewReservation, meta: ReservationRequestMeta): Promise<ReservationRow> {
    return this.db.transaction().execute(async (trx) => {
      // (Round 4) The foreign keys cannot see a SOFT delete, so a booking could still be made
      // on a unit or for a guest that is being removed at that very moment. Share-lock them and
      // look at deleted_at: this conflicts with the delete's FOR UPDATE, so whichever of the
      // two runs second sees the other — the delete counts this booking, or this refuses.
      const room = await trx
        .selectFrom('rooms')
        .select('id')
        .where('id', '=', reservation.room_id)
        .where('deleted_at', 'is', null)
        .forShare()
        .executeTakeFirst();
      if (!room) throw AppError.conflict('Room is not available for the selected dates');
      const contactIds = [
        ...new Set(
          [reservation.contact_id, reservation.billing_contact_id, reservation.booking_coordinator_id].filter(
            (id): id is string => typeof id === 'string'
          )
        ),
      ];
      const liveContacts = await trx
        .selectFrom('contacts')
        .select('id')
        .where('id', 'in', contactIds)
        .where('deleted_at', 'is', null)
        .forShare()
        .execute();
      if (liveContacts.length !== contactIds.length) {
        throw AppError.badRequest('That guest has just been removed — choose a different guest for this booking.');
      }

      const inserted = await trx
        .insertInto('reservations')
        .values(reservation)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'reservations',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();

      return inserted;
    });
  }

  /** Whether a (non-deleted) contact exists — guards the claim flow's FK. */
  async contactExists(contactId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('contacts')
      .select('id')
      .where('id', '=', contactId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Boolean(row);
  }

  /**
   * `roomMove` moves an IN-HOUSE guest to a different unit, and exists because
   * `occupancy` does not follow `reservations.room_id` on its own.
   *
   * The bug it fixes: occupancy.room_id is written once at check-in and was never
   * touched again. The cockpit's in-house and departures cards join rooms through
   * OCCUPANCY, while the unit tiles join through the reservation — so moving a
   * checked-in guest left the board showing them still in the old unit AND showed the
   * new unit as empty. Two screens, two answers, neither of them true.
   *
   * It all rides the ONE transaction the reservation update already had (invariant 6),
   * because a half-applied move is worse than no move: a guest with no room, or a room
   * with two guests, either of which the cockpit would then present as fact.
   *
   * The vacated unit is marked DIRTY as well as AVAILABLE. A unit someone has just
   * moved out of is not ready for the next guest, and leaving housekeeping_status
   * READY would let it be handed over uncleaned.
   *
   * (R5 decision, 2026-10-04 — issue #110) The move also RAISES a housekeeping task for the
   * vacated unit, exactly as check-out does (openTaskOnCheckout, same transaction). A unit
   * marked DIRTY with no task on the board was a clean nobody was asked to do; the tablet
   * board works from tasks, not from the flag.
   */
  async update(
    id: string,
    update: UpdateReservation,
    meta: ReservationRequestMeta,
    roomMove?: { fromRoomId: string; toRoomId: string },
    opts: ReservationUpdateOptions = {}
  ): Promise<ReservationRow | undefined> {
    return inTransaction(this.db, async (trx) => {
      // (Round 4) EVERY edit takes the booking's row lock first and reads the booking as it is
      // NOW, under that lock. Two edits at once used to each work from the row as it was when
      // THEY started, then re-price in separate transactions afterwards — so the second change
      // was priced against a stale figure and the folio ended up billing nights nobody had.
      // The loser of the race now waits here and starts from the winner's committed result.
      const before = await trx
        .selectFrom('reservations')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!before) return undefined;
      opts.validate?.(before);

      const updated = await trx
        .updateTable('reservations')
        .set({ ...update, updated_at: sql`now()` })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'reservations',
          entity_id: id,
          diff: update,
          ip_address: meta.ip ?? null,
        }).execute();
      }

      // Keep what the booking owes in step with what just happened to it, in THIS
      // transaction. A booking that ends (cancelled / no-show) owes nothing, so its open
      // invoice is voided — otherwise Finance would keep chasing a debt that was cancelled
      // with the stay. A caller that has just agreed or changed the price (confirm without
      // payment) asks for a reconcile explicitly.
      const ended =
        update.status != null &&
        (TERMINAL_RESERVATION_STATUSES as readonly string[]).includes(update.status);
      if (updated && (ended || opts.reconcile)) {
        await reconcileReceivable(trx, id, meta, { taxRateBps: opts.taxRateBps });
      }
      // The price follows the edit in the SAME transaction, still under the lock: the edit and
      // its effect on the invoice commit together or not at all. (They used to commit apart, and
      // a failure to re-price was only logged — leaving a booking whose dates and bill disagreed.)
      if (updated && opts.repriceStay) {
        await this.repriceStayChange(trx, before, updated, meta, opts.repriceStay);
      }
      if (updated && opts.refreeze) {
        await this.refreezeUnpaid(trx, updated, meta, opts.refreeze);
      }
      // A booking that ends lets go of any hold still waiting on its payment (re-test 3).
      if (updated && ended) {
        await releaseReservationHolds(trx, id, update.status === 'NO_SHOW' ? 'booking_no_show' : 'booking_cancelled', meta);
      }

      if (updated && roomMove) {
        const occupancy = await trx
          .updateTable('occupancy')
          .set({ room_id: roomMove.toRoomId, updated_by: meta.userId, updated_at: sql`now()` })
          .where('reservation_id', '=', id)
          .where('status', '=', 'CHECKED_IN')
          .where('deleted_at', 'is', null)
          .returning('id')
          .executeTakeFirst();

        await trx.updateTable('rooms')
          .set({
            status: 'AVAILABLE',
            housekeeping_status: 'DIRTY',
            updated_by: meta.userId,
            updated_at: sql`now()`,
          })
          .where('id', '=', roomMove.fromRoomId)
          .execute();
        await new HousekeepingRepository(this.db).openTaskOnCheckout(
          roomMove.fromRoomId,
          occupancy?.id ?? null,
          meta,
          trx
        );

        await trx.updateTable('rooms')
          .set({ status: 'OCCUPIED', updated_by: meta.userId, updated_at: sql`now()` })
          .where('id', '=', roomMove.toRoomId)
          .execute();

        await trx.insertInto('audit_logs').values([
          ...(occupancy
            ? [{
                request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE' as const,
                entity: 'occupancy', entity_id: occupancy.id,
                diff: { room_id: roomMove.toRoomId, moved_from: roomMove.fromRoomId },
                ip_address: meta.ip ?? null,
              }]
            : []),
          {
            request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE' as const,
            entity: 'rooms', entity_id: roomMove.fromRoomId,
            diff: { status: 'AVAILABLE', housekeeping_status: 'DIRTY', guest_moved_out: id },
            ip_address: meta.ip ?? null,
          },
          {
            request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE' as const,
            entity: 'rooms', entity_id: roomMove.toRoomId,
            diff: { status: 'OCCUPIED', guest_moved_in: id },
            ip_address: meta.ip ?? null,
          },
        ]).execute();
      }

      return updated;
    });
  }

  /**
   * Soft-delete a reservation: stamp deleted_at/deleted_by so it disappears from
   * every list (all queries filter `deleted_at is null`) while the row — and its
   * audit trail — are retained. Used to clear a cancelled booking off the board.
   */
  async softDelete(id: string, meta: ReservationRequestMeta): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const deleted = await trx
        .updateTable('reservations')
        .set({ deleted_at: sql`now()`, deleted_by: meta.userId })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (deleted) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'DELETE',
          entity: 'reservations',
          entity_id: id,
          diff: { deleted_at: deleted.deleted_at, deleted_by: deleted.deleted_by },
          ip_address: meta.ip ?? null,
        }).execute();
        return true;
      }

      return false;
    });
  }

  /**
   * Agree (or re-agree) the booking's price and bring its open invoice in line — one
   * transaction under the booking's lock.
   *
   * `ensure` (default): freeze the folio total if nothing has yet, then reconcile. Used by
   * flows that create money owed without money arriving — a public website booking, a
   * check-in/out — so Finance sees the receivable.
   *
   * `refreeze`: re-price a PENDING booking with NOTHING paid whose total was frozen, after
   * a price-changing edit (dates, unit, discount). Freezing at creation would otherwise
   * turn every such edit into a silent mismatch between folio and invoice. Never touches a
   * booking that has had money or has been confirmed — a confirmed price is an agreement.
   *
   * `adjust`: move a confirmed / part-paid booking's agreed price by `agreed.delta` (see
   * repriceStayChange). The delta is added to the total AS IT STANDS UNDER THE LOCK.
   */
  async agreePrice(
    id: string,
    agreed: { total: number; currency: string; taxRateBps: number; delta?: number } | null,
    meta: ReservationRequestMeta,
    mode: 'ensure' | 'refreeze' | 'adjust' = 'ensure'
  ): Promise<void> {
    await inTransaction(this.db, (trx) => this.agreePriceIn(trx, id, agreed, meta, mode));
  }

  private async agreePriceIn(
    trx: Transaction<Database>,
    id: string,
    agreed: { total: number; currency: string; taxRateBps: number; delta?: number } | null,
    meta: ReservationRequestMeta,
    mode: 'ensure' | 'refreeze' | 'adjust'
  ): Promise<void> {
    const reservation = await lockReservation(trx, id);
    if (!reservation) return;

    // A price adjustment is the one place a total may legitimately become 0 (a comp stay)
    // and the one place it is derived from the locked row, so it is resolved first.
    if (agreed && mode === 'adjust' && agreed.delta != null && reservation.folio_total_amount != null) {
      const next = reservation.folio_total_amount + agreed.delta;
      // No clipping at zero: a negative total means refunds already taken off this booking
      // exceed what the changed stay costs, and quietly flooring it would misstate what the
      // guest is owed. Refuse the edit (it rolls back whole) and let a person decide.
      if (next < 0) {
        throw AppError.conflict(
          `This change would take the booking’s agreed price below zero (${describeThebe(next)}), because earlier refunds have already reduced it. Ask the owner to review the refunds before changing these dates.`
        );
      }
      agreed = { ...agreed, total: next };
    }

    if (agreed && (agreed.total > 0 || (mode === 'adjust' && agreed.total === 0))) {
      let freeze = reservation.folio_total_amount == null;
      if (mode === 'refreeze') {
        const paid = (await paidToDate(trx, [id])).get(id) ?? 0;
        freeze =
          reservation.status === 'PENDING' &&
          reservation.folio_total_amount != null &&
          reservation.folio_total_amount !== agreed.total &&
          paid === 0;
      } else if (mode === 'adjust') {
        freeze = reservation.folio_total_amount !== agreed.total;
      }
      if (freeze) {
        await trx
          .updateTable('reservations')
          .set({
            folio_total_amount: agreed.total,
            folio_currency: agreed.currency,
            updated_by: meta.userId,
            updated_at: sql`now()`,
          })
          .where('id', '=', id)
          .execute();
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'reservations',
          entity_id: id,
          diff: {
            folio_total_amount: agreed.total,
            ...(mode === 'adjust' ? { from: reservation.folio_total_amount } : {}),
            reason:
              mode === 'refreeze'
                ? 'price re-agreed after edit'
                : mode === 'adjust'
                  ? 'price adjusted for changed dates or unit'
                  : 'price agreed',
          },
          ip_address: meta.ip ?? null,
        }).execute();
      }
    }

    await reconcileReceivable(trx, id, meta, {
      taxRateBps: agreed?.taxRateBps,
      currency: agreed?.currency,
    });
  }

  /**
   * (Round 4) After a date or unit change, move what the booking owes — INSIDE the edit's own
   * transaction, with the booking still locked.
   *
   * It used to run after the edit had committed, in a second transaction, working from the
   * `before` / `after` rows of ITS edit. With two edits in flight each priced a delta against
   * a different "before", the deltas no longer telescoped, and a clip at zero hid the rest:
   * three parallel edits left the folio and invoice P5,130 above the price of the final dates
   * (or below it). Now there is no "later" and no stale row: `before` is read under the lock
   * (it IS the previous edit's committed result) and `after` is what this edit just wrote, so
   * the deltas of any number of racing edits add up to exactly (final stay − original stay).
   *
   * An unpaid PENDING booking is simply re-priced from scratch. Every other live booking —
   * CONFIRMED (paid or not, invariant 3), part-paid, CHECKED_IN — moves by the DIFFERENCE
   * between the stay as it was and as it is, both at today's rates. That is still not a full
   * re-price of the agreed total: negotiated rates and refunds already lowered off the total
   * (owner decision: a refund never puts the guest back in debt) must survive a date change.
   * When nothing has been negotiated or refunded the two are identical, and the folio equals
   * the recomputed price of the final dates.
   */
  private async repriceStayChange(
    trx: Transaction<Database>,
    before: ReservationRow,
    after: ReservationRow,
    meta: ReservationRequestMeta,
    price: StayPricer
  ): Promise<void> {
    if (after.folio_total_amount == null) return; // never priced — nothing agreed to move
    if (!['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(after.status)) return;

    const paid = (await paidToDate(trx, [after.id])).get(after.id) ?? 0;
    if (after.status === 'PENDING' && paid === 0) {
      await this.refreezeUnpaid(trx, after, meta, price);
      return;
    }

    const was = await price(trx, before, before);
    const now = await price(trx, after, after);
    if (!was.priceable || !now.priceable) return;
    const delta = now.total_amount - was.total_amount;
    if (delta === 0) return;

    await this.agreePriceIn(
      trx,
      after.id,
      { total: after.folio_total_amount + delta, delta, currency: now.currency, taxRateBps: now.tax_rate_bps },
      meta,
      'adjust'
    );
  }

  /** Re-agree the price of an unpaid PENDING booking from the row as it now stands (under the lock). */
  private async refreezeUnpaid(
    trx: Transaction<Database>,
    current: ReservationRow,
    meta: ReservationRequestMeta,
    price: StayPricer
  ): Promise<void> {
    if (current.status !== 'PENDING' || current.folio_total_amount == null) return;
    const priced = await price(trx, current, current);
    if (!priced.priceable) return;
    await this.agreePriceIn(
      trx,
      current.id,
      { total: priced.total_amount, currency: priced.currency, taxRateBps: priced.tax_rate_bps },
      meta,
      'refreeze'
    );
  }
}
