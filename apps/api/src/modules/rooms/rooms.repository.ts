import { assertCanDelete } from '../../core/integrity/liveBookings.js';
import { Kysely, sql } from 'kysely';
import { AppError } from '../../core/errors/AppError.js';
import { todayInPropertyTZ } from '../../core/time.js';
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

  /**
   * A unit even if it has since been soft-deleted. Only for resolving what a booking already
   * made against it points at (its unit type for pricing); nothing new may be booked on a
   * deleted unit, so every other read keeps using findById.
   */
  async findByIdWithDeleted(id: string): Promise<RoomRow | undefined> {
    return this.db
      .selectFrom('rooms')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  // Case-insensitive lookup of an active room by code (used to enforce uniqueness).
  // Code uniqueness is scoped to the building (block) — see migration 051. Two
  // blocks (or properties) may each reuse a code; only a clash within the same
  // building is rejected. building_id null is its own group.
  /** The property a room belongs to (room → building → property), or null. Used by
   *  the by-id scope guard. */
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

  async findByCodeInBuilding(code: string, buildingId: string | null): Promise<RoomRow | undefined> {
    let query = this.db
      .selectFrom('rooms')
      .selectAll()
      .where(sql`lower(code)`, '=', code.toLowerCase())
      .where('deleted_at', 'is', null);
    query =
      buildingId === null
        ? query.where('building_id', 'is', null)
        : query.where('building_id', '=', buildingId);
    return query.executeTakeFirst();
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
      query.limit(pagination.limit).offset(offset).orderBy('rooms.created_at', 'desc').orderBy('rooms.id', 'desc').execute(),
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

  /**
   * (R7 N7-4) Take a unit off sale (MAINTENANCE / OUT_OF_SERVICE). If it still has bookings
   * or live bare holds from today on, that is a question (409 "Unit Has Bookings") unless
   * `confirm` — then the status changes, bare holds are released (their payment attempts
   * expire) and bookings stay exactly where they are for staff to move. Checked under a lock
   * on the unit's row, so a booking can't slip in between the check and the change.
   */
  async closeUnit(
    id: string,
    status: 'MAINTENANCE' | 'OUT_OF_SERVICE',
    confirm: boolean,
    meta: RoomRequestMeta
  ): Promise<RoomRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const locked = await trx.selectFrom('rooms').select('id').where('id', '=', id)
        .where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
      if (!locked) return undefined;

      const today = todayInPropertyTZ();
      const bookings = await sql<{ n: string }>`
        SELECT count(*) AS n FROM reservations r
         WHERE r.room_id = ${id}::uuid AND r.deleted_at IS NULL
           AND r.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
           AND r.check_out_date > ${today}::date`.execute(trx);
      const holds = await sql<{ id: string }>`
        SELECT h.id FROM holds h
         WHERE h.room_id = ${id}::uuid AND h.status = 'HELD' AND h.deleted_at IS NULL
           AND h.reservation_id IS NULL AND h.held_until > now()`.execute(trx);
      const booked = Number(bookings.rows[0]?.n ?? 0);
      const holdIds = holds.rows.map((h) => h.id);

      if ((booked > 0 || holdIds.length > 0) && !confirm) {
        const parts = [
          booked ? `${booked} booking${booked === 1 ? '' : 's'}` : '',
          holdIds.length ? `${holdIds.length} hold${holdIds.length === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' and ');
        const what = status === 'MAINTENANCE' ? 'into maintenance' : 'out of service';
        throw new AppError(
          409,
          'Unit Has Bookings',
          `This unit still has ${parts} from today on. Move the guests first — or take it ${what} anyway (holds will be released; bookings stay where they are for you to move).`,
        );
      }

      if (holdIds.length) {
        await trx.updateTable('holds')
          .set({ status: 'RELEASED', release_reason: 'unit_closed', updated_by: meta.userId, updated_at: sql`now()` })
          .where('id', 'in', holdIds).where('status', '=', 'HELD').execute();
        const expired = await trx.updateTable('payment_intents')
          .set({ status: 'EXPIRED', last_error: 'unit taken off sale', updated_by: meta.userId, updated_at: sql`now()` })
          .where('hold_id', 'in', holdIds).where('status', 'in', ['PENDING', 'RETRY'])
          .returning('id').execute();
        await trx.insertInto('audit_logs').values([
          ...holdIds.map((holdId) => ({
            request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE' as const,
            entity: 'holds', entity_id: holdId, diff: { status: 'RELEASED', release_reason: 'unit_closed' },
            ip_address: meta.ip ?? null,
          })),
          ...expired.map((pi) => ({
            request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE' as const,
            entity: 'payment_intents', entity_id: pi.id, diff: { status: 'EXPIRED', reason: 'unit_closed' },
            ip_address: meta.ip ?? null,
          })),
        ]).execute();
      }

      const updated = await trx.updateTable('rooms')
        .set({ status, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', id).returningAll().executeTakeFirst();
      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'rooms', entity_id: id,
        diff: { status, ...(booked || holdIds.length ? { closed_with_bookings: booked, released_holds: holdIds.length } : {}) },
        ip_address: meta.ip ?? null,
      }).execute();
      return updated;
    });
  }

  // New unguessable export-feed token. Rotating kills the old feed URL instantly —
  // use when a URL leaked or a unit leaves Booking.com. The audit row deliberately
  // records only THAT it rotated, never the token value.
  async rotateIcalToken(id: string, meta: RoomRequestMeta): Promise<RoomRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('rooms')
        .set({ ical_token: sql`gen_random_uuid()`, updated_by: meta.userId, updated_at: sql`now()` })
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
          diff: { ical_token: 'rotated' },
          ip_address: meta.ip ?? null,
        }).execute();
      }

      return updated;
    });
  }

  // New in-apartment QR check-in token (Phase 5). Rotating invalidates the old
  // sticker instantly — reprint after. Separate from ical_token by design.
  async rotateGuestToken(id: string, meta: RoomRequestMeta): Promise<RoomRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('rooms')
        .set({ guest_qr_token: sql`gen_random_uuid()`, updated_by: meta.userId, updated_at: sql`now()` })
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
          diff: { guest_qr_token: 'rotated' },
          ip_address: meta.ip ?? null,
        }).execute();
      }

      return updated;
    });
  }

  async softDelete(id: string, meta: RoomRequestMeta): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      // (Round 4) Refuse — 409, in plain English — while live bookings or unpaid invoices
      // still point at the unit; decided under a lock on the unit so a booking made at the
      // same moment is either counted or waits. false = already gone.
      if (!(await assertCanDelete(trx, { kind: 'room', id }))) return false;
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
