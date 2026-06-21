import { Kysely, sql } from 'kysely';
import type { Database, ReservationRow, NewReservation, UpdateReservation } from '../../db/types.js';
import type { ReservationFilters, ReservationPaginationOptions, PaginatedReservationResult, ReservationRequestMeta, ReservationListRow } from './reservations.types.js';

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
      .where('status', 'not in', ['CANCELLED', 'CHECKED_OUT'])
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
      .leftJoin('rooms', 'rooms.id', 'reservations.room_id')
      .leftJoin('buildings', 'buildings.id', 'rooms.building_id')
      .leftJoin('properties', 'properties.id', 'buildings.property_id')
      .selectAll('reservations')
      .select([
        'contacts.name as guest_name',
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
