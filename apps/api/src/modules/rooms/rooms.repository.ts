import { Kysely, sql } from 'kysely';
import type { Database, RoomRow, NewRoom, UpdateRoom } from '../../db/types.js';
import type { RoomFilters, RoomPaginationOptions, PaginatedRoomResult, RoomRequestMeta, RoomListRow } from './rooms.types.js';

export class RoomsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<RoomRow | undefined> {
    return this.db
      .selectFrom('rooms')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  // Case-insensitive lookup of an active room by code (used to enforce uniqueness).
  async findByCode(code: string): Promise<RoomRow | undefined> {
    return this.db
      .selectFrom('rooms')
      .selectAll()
      .where(sql`lower(code)`, '=', code.toLowerCase())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  // Active units bookable right now: operationally AVAILABLE and housekeeping READY.
  async listAvailable(propertyId?: string): Promise<RoomRow[]> {
    let query = this.db
      .selectFrom('rooms')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('status', '=', 'AVAILABLE')
      .where('housekeeping_status', '=', 'READY');
    // Scope to the active property: only units whose building belongs to it.
    if (propertyId) {
      query = query.where(
        'building_id',
        'in',
        this.db.selectFrom('buildings').select('id').where('property_id', '=', propertyId),
      );
    }
    return query.orderBy('code', 'asc').execute();
  }

  async findPaginated(
    filters: RoomFilters,
    pagination: RoomPaginationOptions
  ): Promise<PaginatedRoomResult<RoomListRow>> {
    let query = this.db
      .selectFrom('rooms')
      .leftJoin('buildings', 'buildings.id', 'rooms.building_id')
      .leftJoin('properties', 'properties.id', 'buildings.property_id')
      .selectAll('rooms')
      .select([
        'buildings.name as building_name',
        'buildings.property_id as property_id',
        'properties.name as property_name',
      ])
      .where('rooms.deleted_at', 'is', null);

    let countQuery = this.db
      .selectFrom('rooms')
      .leftJoin('buildings', 'buildings.id', 'rooms.building_id')
      .select(this.db.fn.count<number>('rooms.id').as('total'))
      .where('rooms.deleted_at', 'is', null);

    if (filters.status) {
      query = query.where('rooms.status', '=', filters.status);
      countQuery = countQuery.where('rooms.status', '=', filters.status);
    }

    if (filters.type) {
      query = query.where('rooms.type', '=', filters.type);
      countQuery = countQuery.where('rooms.type', '=', filters.type);
    }

    if (filters.property_id) {
      query = query.where('buildings.property_id', '=', filters.property_id);
      countQuery = countQuery.where('buildings.property_id', '=', filters.property_id);
    }

    if (filters.building_id) {
      query = query.where('rooms.building_id', '=', filters.building_id);
      countQuery = countQuery.where('rooms.building_id', '=', filters.building_id);
    }

    if (filters.search) {
      const searchPattern = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('rooms.name', 'ilike', searchPattern),
          eb('rooms.code', 'ilike', searchPattern),
        ])
      );
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('rooms.name', 'ilike', searchPattern),
          eb('rooms.code', 'ilike', searchPattern),
        ])
      );
    }

    const offset = (pagination.page - 1) * pagination.limit;

    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('rooms.created_at', 'desc').execute(),
      countQuery.execute(),
    ]);

    return {
      data: data as RoomListRow[],
      total: Number(total),
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async create(room: NewRoom, meta: RoomRequestMeta): Promise<RoomRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('rooms')
        .values(room)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'rooms',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();

      return inserted;
    });
  }

  async update(id: string, update: UpdateRoom, meta: RoomRequestMeta): Promise<RoomRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('rooms')
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
          entity: 'rooms',
          entity_id: id,
          diff: update,
          ip_address: meta.ip ?? null,
        }).execute();
      }

      return updated;
    });
  }

  async softDelete(id: string, meta: RoomRequestMeta): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const deleted = await trx
        .updateTable('rooms')
        .set({
          deleted_at: sql`now()`,
          deleted_by: meta.userId,
        })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (deleted) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'DELETE',
          entity: 'rooms',
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
