import { Kysely, sql } from 'kysely';
import type { Database, OccupancyRow } from '../../db/types.js';
import { HousekeepingRepository } from '../housekeeping/housekeeping.repository.js';
import type {
  OccupancyFilters,
  OccupancyPaginationOptions,
  PaginatedOccupancyResult,
  OccupancyRequestMeta,
} from './checkins.types.js';

interface CheckInParams {
  reservationId: string;
  roomId: string;
  guestCount: number;
  notes?: string | null;
  checkedInAt?: Date;
}

export class CheckinsRepository {
  private readonly housekeeping: HousekeepingRepository;

  constructor(private readonly db: Kysely<Database>) {
    this.housekeeping = new HousekeepingRepository(db);
  }

  async findById(id: string): Promise<OccupancyRow | undefined> {
    return this.db
      .selectFrom('occupancy')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  // Lightweight lookups used by the service to enforce the check-in rules.
  async findReservation(id: string) {
    return this.db
      .selectFrom('reservations')
      .select(['id', 'status', 'room_id', 'contact_id'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async findRoom(id: string) {
    return this.db
      .selectFrom('rooms')
      .select(['id', 'status', 'housekeeping_status'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  // Currently checked-in occupancy records.
  async findActive(propertyId?: string): Promise<OccupancyRow[]> {
    let query = this.db
      .selectFrom('occupancy')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('status', '=', 'CHECKED_IN');
    if (propertyId) {
      query = query.where(sql<boolean>`exists (
        select 1 from rooms r join buildings b on b.id = r.building_id
        where r.id = occupancy.room_id and b.property_id = ${propertyId}
      )`);
    }
    return query.orderBy('checked_in_at', 'desc').execute();
  }

  async findPaginated(
    filters: OccupancyFilters,
    pagination: OccupancyPaginationOptions
  ): Promise<PaginatedOccupancyResult<OccupancyRow>> {
    let query = this.db
      .selectFrom('occupancy')
      .selectAll()
      .where('deleted_at', 'is', null);

    let countQuery = this.db
      .selectFrom('occupancy')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
    }
    if (filters.room_id) {
      query = query.where('room_id', '=', filters.room_id);
      countQuery = countQuery.where('room_id', '=', filters.room_id);
    }
    if (filters.reservation_id) {
      query = query.where('reservation_id', '=', filters.reservation_id);
      countQuery = countQuery.where('reservation_id', '=', filters.reservation_id);
    }
    if (filters.property_id) {
      const inProperty = sql<boolean>`exists (
        select 1 from rooms r join buildings b on b.id = r.building_id
        where r.id = occupancy.room_id and b.property_id = ${filters.property_id}
      )`;
      query = query.where(inProperty);
      countQuery = countQuery.where(inProperty);
    }

    const offset = (pagination.page - 1) * pagination.limit;

    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('created_at', 'desc').execute(),
      countQuery.execute(),
    ]);

    return { data, total: Number(total), page: pagination.page, limit: pagination.limit };
  }

  // Check in: create occupancy, flip reservation -> CHECKED_IN and room -> OCCUPIED,
  // all in one transaction with an audit row per mutated entity.
  async checkIn(params: CheckInParams, meta: OccupancyRequestMeta): Promise<OccupancyRow> {
    return this.db.transaction().execute(async (trx) => {
      const occupancy = await trx
        .insertInto('occupancy')
        .values({
          reservation_id: params.reservationId,
          room_id: params.roomId,
          status: 'CHECKED_IN',
          checked_in_at: params.checkedInAt ?? new Date(),
          guest_count: params.guestCount,
          notes: params.notes ?? null,
          created_by: meta.userId,
          updated_by: meta.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.updateTable('reservations')
        .set({ status: 'CHECKED_IN', updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', params.reservationId)
        .execute();

      await trx.updateTable('rooms')
        .set({ status: 'OCCUPIED', updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', params.roomId)
        .execute();

      await trx.insertInto('audit_logs').values([
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'CREATE', entity: 'occupancy', entity_id: occupancy.id, diff: occupancy, ip_address: meta.ip ?? null },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'reservations', entity_id: params.reservationId, diff: { status: 'CHECKED_IN' }, ip_address: meta.ip ?? null },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'rooms', entity_id: params.roomId, diff: { status: 'OCCUPIED' }, ip_address: meta.ip ?? null },
      ]).execute();

      return occupancy;
    });
  }

  // Check out: close occupancy, flip reservation -> CHECKED_OUT and room -> AVAILABLE.
  async checkOut(
    occupancyId: string,
    reservationId: string,
    roomId: string,
    checkedOutAt: Date,
    notes: string | null | undefined,
    meta: OccupancyRequestMeta
  ): Promise<OccupancyRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const occupancy = await trx
        .updateTable('occupancy')
        .set({
          status: 'CHECKED_OUT',
          checked_out_at: checkedOutAt,
          ...(notes !== undefined ? { notes } : {}),
          updated_by: meta.userId,
          updated_at: sql`now()`,
        })
        .where('id', '=', occupancyId)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (!occupancy) return undefined;

      await trx.updateTable('reservations')
        .set({ status: 'CHECKED_OUT', updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', reservationId)
        .execute();

      await trx.updateTable('rooms')
        .set({ status: 'AVAILABLE', updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', roomId)
        .execute();

      await trx.insertInto('audit_logs').values([
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'occupancy', entity_id: occupancy.id, diff: { status: 'CHECKED_OUT', checked_out_at: occupancy.checked_out_at }, ip_address: meta.ip ?? null },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'reservations', entity_id: reservationId, diff: { status: 'CHECKED_OUT' }, ip_address: meta.ip ?? null },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'rooms', entity_id: roomId, diff: { status: 'AVAILABLE' }, ip_address: meta.ip ?? null },
      ]).execute();

      // A departure dirties the unit and queues its turn — same transaction, so
      // a vacated unit is never silently re-bookable before it has been cleaned.
      await this.housekeeping.openTaskOnCheckout(roomId, occupancyId, meta, trx);

      return occupancy;
    });
  }
}
