import { Kysely, sql } from 'kysely';
import type { Database, ReservationRow, NewReservation, UpdateReservation } from '../../db/types.js';
import type { ReservationFilters, ReservationPaginationOptions, PaginatedReservationResult, ReservationRequestMeta } from './reservations.types.js';

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
  ): Promise<PaginatedReservationResult<ReservationRow>> {
    let query = this.db
      .selectFrom('reservations')
      .selectAll()
      .where('deleted_at', 'is', null);

    let countQuery = this.db
      .selectFrom('reservations')
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

    if (filters.contact_id) {
      query = query.where('contact_id', '=', filters.contact_id);
      countQuery = countQuery.where('contact_id', '=', filters.contact_id);
    }

    if (filters.search) {
      const searchPattern = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('notes', 'ilike', searchPattern),
        ])
      );
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('notes', 'ilike', searchPattern),
        ])
      );
    }

    const offset = (pagination.page - 1) * pagination.limit;
    
    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('created_at', 'desc').execute(),
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
}
