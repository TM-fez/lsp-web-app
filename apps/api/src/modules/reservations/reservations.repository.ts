import { Kysely, sql } from 'kysely';
import type { Database, ReservationRow, NewReservation, UpdateReservation } from '../../db/types.js';
import type { ReservationFilters, ReservationPaginationOptions, PaginatedReservationResult, ReservationRequestMeta, ReservationListRow, FolioInvoiceLine } from './reservations.types.js';

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
   * ── THE folio arithmetic. One definition, deliberately. ──────────────────────
   *
   * How much money has actually arrived against a booking, in thebe.
   *
   * Why it lives in exactly one place: D01 was two definitions of "blocked" drifting
   * apart. A second definition of "paid" would fail the same way — so every caller
   * (the folio read, list badges, the cockpit, markPaid's cap) comes through here.
   * When `payments` + `payment_allocations` land (G30, closing D04) the body of this
   * one query changes to sum allocations, and every caller follows for free.
   *
   * ⚠️ The refund subtlety, which the obvious query gets backwards:
   * refundInvoice() marks the ORIGINAL invoice 'REFUNDED' and inserts a SEPARATE
   * positive row with kind='REFUND', status='PAID'. So filtering on status='PAID'
   * alone drops the original from the positive side while keeping the refund on the
   * negative side: a P1,000 booking refunded P300 would read as −P300 paid instead of
   * P700. A REFUNDED invoice was still paid — the money did arrive — so both statuses
   * count, and the REFUND row is what takes it back out.
   */
  async paidToDate(reservationIds: string[]): Promise<Map<string, number>> {
    const paid = new Map<string, number>();
    if (reservationIds.length === 0) return paid;

    const rows = await this.db
      .selectFrom('invoices')
      .select(['reservation_id'])
      .select(
        sql<string>`COALESCE(SUM(CASE WHEN kind = 'REFUND' THEN -total_amount ELSE total_amount END), 0)`.as('paid')
      )
      .where('reservation_id', 'in', reservationIds)
      .where('deleted_at', 'is', null)
      .where('status', 'in', ['PAID', 'REFUNDED'])
      .groupBy('reservation_id')
      .execute();

    for (const row of rows) {
      // SUM() comes back as a string from pg (bigint), so Number() it here rather than
      // letting a string leak into money arithmetic (invariant 1: integer thebe).
      if (row.reservation_id) paid.set(row.reservation_id, Number(row.paid));
    }
    return paid;
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

  /** The property a room belongs to (room → building → property), or null. */
  async roomPropertyId(roomId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('rooms')
      .leftJoin('buildings', 'buildings.id', 'rooms.building_id')
      .select('buildings.property_id as property_id')
      .where('rooms.id', '=', roomId)
      .where('rooms.deleted_at', 'is', null)
      .executeTakeFirst();
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

  async update(id: string, update: UpdateReservation, meta: ReservationRequestMeta): Promise<ReservationRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
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
}
