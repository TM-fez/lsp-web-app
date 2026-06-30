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
  // keeps every work-order column, then we add the four resolved names.
  private withPeople(trx: DB = this.db) {
    return trx
      .selectFrom('maintenance_work_orders as wo')
      .leftJoin('users as reporter', 'reporter.id', 'wo.reported_by')
      .leftJoin('users as assignee', 'assignee.id', 'wo.assigned_to')
      .leftJoin('users as completer', 'completer.id', 'wo.completed_by')
      .leftJoin('users as approver', 'approver.id', 'wo.approved_by')
      .selectAll('wo')
      .select([
        'reporter.name as reported_by_name',
        'assignee.name as assigned_to_name',
        'completer.name as completed_by_name',
        'approver.name as approved_by_name',
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
      q.limit(query.limit).offset(offset).orderBy('wo.created_at', 'desc').execute(),
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
