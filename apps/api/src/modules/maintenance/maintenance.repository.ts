import { propertyToday } from '../../core/time.js';
import { Kysely, sql, Transaction } from 'kysely';
import type { Database, MaintenanceWorkOrderRow, NewMaintenanceWorkOrder, UpdateMaintenanceWorkOrder } from '../../db/types.js';
import type { MaintenanceQueryDTO } from './maintenance.types.js';

type DB = Kysely<Database> | Transaction<Database>;

export class MaintenanceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async transaction<T>(callback: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(callback);
  }

  async create(data: NewMaintenanceWorkOrder, meta: { userId: string, requestId?: string }, trx: DB = this.db): Promise<MaintenanceWorkOrderRow> {
    const inserted = await trx
      .insertInto('maintenance_work_orders')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx.insertInto('audit_logs').values({
      request_id: meta.requestId ?? null,
      user_id: meta.userId,
      action: 'CREATE',
      entity: 'maintenance_work_orders',
      entity_id: inserted.id,
      diff: inserted,
    }).execute();

    return inserted;
  }

  // Base select that LEFT-joins users for the accountability names. selectAll('wo')
  // keeps every work-order column, then we add the four resolved names plus the
  // unit's owner attribution (Phase 3 — whose repair bill this is).
  private withPeople(trx: DB = this.db) {
    return trx
      .selectFrom('maintenance_work_orders as wo')
      .leftJoin('users as reporter', 'reporter.id', 'wo.reported_by')
      .leftJoin('users as assignee', 'assignee.id', 'wo.assigned_to')
      .leftJoin('users as completer', 'completer.id', 'wo.completed_by')
      .leftJoin('users as approver', 'approver.id', 'wo.approved_by')
      .leftJoin('rooms as room', 'room.id', 'wo.room_id')
      .selectAll('wo')
      .select([
        'reporter.name as reported_by_name',
        'assignee.name as assigned_to_name',
        'completer.name as completed_by_name',
        'approver.name as approved_by_name',
        'room.ownership as room_ownership',
        'room.landlord_name',
        'room.landlord_phone',
      ]);
  }

  async findById(id: string, trx: DB = this.db): Promise<MaintenanceWorkOrderRow | undefined> {
    return trx
      .selectFrom('maintenance_work_orders')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Single work order with the accountability names resolved (for GET /:id). */
  async findByIdWithPeople(id: string) {
    return this.withPeople()
      .where('wo.id', '=', id)
      .where('wo.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /** Is this id an active staff user? Guards assignment against dangling refs. */
  async isActiveUser(id: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('users')
      .select('id')
      .where('id', '=', id)
      .where('active', '=', true)
      .executeTakeFirst();
    return !!row;
  }

  // Room ids belonging to a property (room → building → property) — scopes the
  // work-order list to the active property.
  private roomIdsInProperty(propertyId: string) {
    return this.db
      .selectFrom('rooms as r2')
      .innerJoin('buildings as b2', 'b2.id', 'r2.building_id')
      .select('r2.id')
      .where('b2.property_id', '=', propertyId);
  }

  /** The property a work order's room belongs to (WO → room → building → property),
   *  or null if the WO doesn't exist / has no property. Used by the by-id scope guard. */
  async workOrderPropertyId(workOrderId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('maintenance_work_orders as wo')
      .leftJoin('rooms as r', 'r.id', 'wo.room_id')
      .leftJoin('buildings as b', 'b.id', 'r.building_id')
      .select('b.property_id as property_id')
      .where('wo.id', '=', workOrderId)
      .where('wo.deleted_at', 'is', null)
      .executeTakeFirst();
    return row?.property_id ?? null;
  }

  /** Who a work order is assigned to (or null) — feeds the contractor by-id guard. */
  async workOrderAssignee(workOrderId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('maintenance_work_orders')
      .select('assigned_to')
      .where('id', '=', workOrderId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row?.assigned_to ?? null;
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

  async findPaginated(query: MaintenanceQueryDTO, propertyId?: string) {
    let q = this.withPeople().where('wo.deleted_at', 'is', null);
    let countQ = this.db.selectFrom('maintenance_work_orders').select(this.db.fn.count<number>('id').as('total')).where('deleted_at', 'is', null);

    if (propertyId) {
      q = q.where('wo.room_id', 'in', this.roomIdsInProperty(propertyId));
      countQ = countQ.where('room_id', 'in', this.roomIdsInProperty(propertyId));
    }

    if (query.room_id) {
      q = q.where('wo.room_id', '=', query.room_id);
      countQ = countQ.where('room_id', '=', query.room_id);
    }
    if (query.status) {
      q = q.where('wo.status', '=', query.status);
      countQ = countQ.where('status', '=', query.status);
    }
    if (query.assigned_to) {
      q = q.where('wo.assigned_to', '=', query.assigned_to);
      countQ = countQ.where('assigned_to', '=', query.assigned_to);
    }

    const offset = (query.page - 1) * query.limit;

    const [data, [{ total }]] = await Promise.all([
      q.limit(query.limit).offset(offset).orderBy('wo.created_at', 'desc').orderBy('wo.id', 'desc').execute(),
      countQ.execute(),
    ]);

    return { data, total: Number(total), page: query.page, limit: query.limit };
  }

  async update(id: string, data: UpdateMaintenanceWorkOrder, meta: { userId: string, requestId?: string }, trx: DB = this.db): Promise<MaintenanceWorkOrderRow> {
    const updated = await trx
      .updateTable('maintenance_work_orders')
      .set({ ...data, updated_at: sql`now()` })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx.insertInto('audit_logs').values({
      request_id: meta.requestId ?? null,
      user_id: meta.userId,
      action: 'UPDATE',
      entity: 'maintenance_work_orders',
      entity_id: id,
      diff: data,
    }).execute();

    return updated;
  }

  async softDelete(id: string, meta: { userId: string, requestId?: string }, trx: DB = this.db): Promise<void> {
    const updated = await trx
      .updateTable('maintenance_work_orders')
      .set({
        deleted_at: sql`now()`,
        deleted_by: meta.userId,
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (updated) {
      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'DELETE',
        entity: 'maintenance_work_orders',
        entity_id: id,
        diff: { deleted_at: updated.deleted_at },
      }).execute();
    }
  }

  /**
   * (Re-test round 3) Put the unit's status in line with its open repairs.
   *
   * Every new work order used to flip the unit to MAINTENANCE — a LOW "dripping tap"
   * included — and that blocks the unit for every date, for everyone. Completing or
   * cancelling ANY order flipped it straight back to AVAILABLE, even with another
   * serious job still open, or a guest in the room (OCCUPIED → AVAILABLE).
   *
   * Now: a unit is under MAINTENANCE while it has an open HIGH or CRITICAL order; LOW /
   * MEDIUM jobs are done around the guests. An OCCUPIED or OUT_OF_SERVICE unit is never
   * touched here — check-out and the out-of-service switch own those states.
   *
   * (R5, migration 085) Only an order WITHOUT a block window does this. One with dates
   * blocks just those nights (core/availability/repairWindows.ts) and leaves the status
   * alone — MAINTENANCE has no end date, so it would block every night again.
   */
  async syncRoomForMaintenance(roomId: string, meta: { userId: string; requestId?: string }, trx: DB = this.db) {
    const room = await trx.selectFrom('rooms').select('status').where('id', '=', roomId)
      .where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
    if (!room || room.status === 'OCCUPIED' || room.status === 'OUT_OF_SERVICE') return;
    const blocking = await trx.selectFrom('maintenance_work_orders').select('id')
      .where('room_id', '=', roomId)
      .where('deleted_at', 'is', null)
      .where('status', 'not in', ['COMPLETED', 'CANCELLED'])
      .where('priority', 'in', ['HIGH', 'CRITICAL'])
      .where('blocks_from', 'is', null)
      .limit(1).executeTakeFirst();
    const want = blocking ? 'MAINTENANCE' : 'AVAILABLE';
    if (room.status !== want) await this.updateRoomStatus(roomId, want, meta, trx);
  }

  /**
   * (R6) What a serious repair would take out of use: live bookings and live bare holds on
   * this unit during [from, to). With no window the repair closes the unit from today on,
   * open-ended, so anything still to come counts.
   */
  async repairConflicts(roomId: string, from: string | null, to: string | null, trx: DB = this.db) {
    const start = from ?? propertyToday();
    const bookings = await sql<{ n: string }>`
      SELECT count(*) AS n FROM reservations r
       WHERE r.room_id = ${roomId}::uuid AND r.deleted_at IS NULL
         AND r.status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED')
         AND r.check_out_date > ${start}::date
         AND (${to}::date IS NULL OR r.check_in_date < ${to}::date)`.execute(trx);
    const holds = await sql<{ id: string }>`
      SELECT h.id FROM holds h
       WHERE h.room_id = ${roomId}::uuid AND h.status = 'HELD' AND h.deleted_at IS NULL
         AND h.reservation_id IS NULL AND h.held_until > now()
         AND h.check_out_date > ${start}::date
         AND (${to}::date IS NULL OR h.check_in_date < ${to}::date)`.execute(trx);
    return { bookings: Number(bookings.rows[0]?.n ?? 0), holdIds: holds.rows.map((h) => h.id) };
  }

  /** Release bare holds a confirmed repair now covers (their payment attempts expire too). */
  async releaseHoldsForRepair(holdIds: string[], meta: { userId: string; requestId?: string }, trx: DB = this.db) {
    if (holdIds.length === 0) return;
    await trx.updateTable('holds')
      .set({ status: 'RELEASED', release_reason: 'repair', updated_by: meta.userId, updated_at: sql`now()` })
      .where('id', 'in', holdIds).where('status', '=', 'HELD').execute();
    const expired = await trx.updateTable('payment_intents')
      .set({ status: 'EXPIRED', last_error: 'unit closed for a repair', updated_by: meta.userId, updated_at: sql`now()` })
      .where('hold_id', 'in', holdIds).where('status', 'in', ['PENDING', 'RETRY'])
      .returning('id').execute();
    await trx.insertInto('audit_logs').values([
      ...holdIds.map((id) => ({
        request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE' as const,
        entity: 'holds', entity_id: id, diff: { status: 'RELEASED', release_reason: 'repair' },
      })),
      ...expired.map((pi) => ({
        request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE' as const,
        entity: 'payment_intents', entity_id: pi.id, diff: { status: 'EXPIRED', reason: 'repair' },
      })),
    ]).execute();
  }

  async updateRoomStatus(roomId: string, status: 'AVAILABLE' | 'MAINTENANCE', meta: { userId: string, requestId?: string }, trx: DB = this.db) {
    const updated = await trx.updateTable('rooms')
      .set({ status, updated_by: meta.userId, updated_at: sql`now()` })
      .where('id', '=', roomId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();

    await trx.insertInto('audit_logs').values({
      request_id: meta.requestId ?? null,
      user_id: meta.userId,
      action: 'UPDATE',
      entity: 'rooms',
      entity_id: roomId,
      diff: { status },
    }).execute();

    return updated;
  }
}
