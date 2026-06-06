import { Kysely, sql } from 'kysely';
import type { Database, RoomRow, NewRoom, UpdateRoom } from '../../db/types.js';
import type { RoomFilters, RoomPaginationOptions, PaginatedRoomResult, RoomRequestMeta } from './rooms.types.js';

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
  async listAvailable(): Promise<RoomRow[]> {
    return this.db
      .selectFrom('rooms')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('status', '=', 'AVAILABLE')
      .where('housekeeping_status', '=', 'READY')
      .orderBy('code', 'asc')
      .execute();
  }

  async findPaginated(
    filters: RoomFilters,
    pagination: RoomPaginationOptions
  ): Promise<PaginatedRoomResult<RoomRow>> {
    let query = this.db
      .selectFrom('rooms')
      .selectAll()
      .where('deleted_at', 'is', null);

    let countQuery = this.db
      .selectFrom('rooms')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
    }

    if (filters.type) {
      query = query.where('type', '=', filters.type);
      countQuery = countQuery.where('type', '=', filters.type);
    }

    if (filters.search) {
      const searchPattern = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('name', 'ilike', searchPattern),
          eb('code', 'ilike', searchPattern),
        ])
      );
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('name', 'ilike', searchPattern),
          eb('code', 'ilike', searchPattern),
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
