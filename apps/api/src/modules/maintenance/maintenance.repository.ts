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

  async findById(id: string, trx: DB = this.db): Promise<MaintenanceWorkOrderRow | undefined> {
    return trx
      .selectFrom('maintenance_work_orders')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async findPaginated(query: MaintenanceQueryDTO) {
    let q = this.db.selectFrom('maintenance_work_orders').selectAll().where('deleted_at', 'is', null);
    let countQ = this.db.selectFrom('maintenance_work_orders').select(this.db.fn.count<number>('id').as('total')).where('deleted_at', 'is', null);

    if (query.room_id) {
      q = q.where('room_id', '=', query.room_id);
      countQ = countQ.where('room_id', '=', query.room_id);
    }
    if (query.status) {
      q = q.where('status', '=', query.status);
      countQ = countQ.where('status', '=', query.status);
    }
    if (query.assigned_to) {
      q = q.where('assigned_to', '=', query.assigned_to);
      countQ = countQ.where('assigned_to', '=', query.assigned_to);
    }

    const offset = (query.page - 1) * query.limit;

    const [data, [{ total }]] = await Promise.all([
      q.limit(query.limit).offset(offset).orderBy('created_at', 'desc').execute(),
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
