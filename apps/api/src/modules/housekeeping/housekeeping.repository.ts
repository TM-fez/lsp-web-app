import { Kysely, sql, Transaction } from 'kysely';
import type { Database, HousekeepingChecklistItemRow, HousekeepingTaskRow } from '../../db/types.js';
import type {
  HousekeepingQueryDTO,
  HousekeepingRequestMeta,
  HousekeepingStatus,
  HousekeepingTaskStatus,
} from './housekeeping.types.js';

type DB = Kysely<Database> | Transaction<Database>;

export interface HousekeepingQueueItem {
  task_id: string;
  room_id: string;
  room_name: string;
  room_code: string;
  task_status: HousekeepingTaskStatus;
  housekeeping_status: HousekeepingStatus;
  assigned_to: string | null;
  occupancy_id: string | null;
  opened_at: Date;
  started_at: Date | null;
  inspected_at: Date | null;
}

export class HousekeepingRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async transaction<T>(callback: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(callback);
  }

  async findById(id: string, trx: DB = this.db): Promise<HousekeepingTaskRow | undefined> {
    return trx
      .selectFrom('housekeeping_tasks')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  // The single live (not-yet-done) task for a unit, if any.
  async findLiveTaskByRoom(roomId: string, trx: DB = this.db): Promise<HousekeepingTaskRow | undefined> {
    return trx
      .selectFrom('housekeeping_tasks')
      .selectAll()
      .where('room_id', '=', roomId)
      .where('status', '<>', 'DONE')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  // Cleaning queue: every live task with its unit, oldest first.
  async listQueue(propertyId?: string): Promise<HousekeepingQueueItem[]> {
    let query = this.db
      .selectFrom('housekeeping_tasks as t')
      .innerJoin('rooms as r', 'r.id', 't.room_id')
      .select([
        't.id as task_id',
        't.room_id as room_id',
        'r.name as room_name',
        'r.code as room_code',
        't.status as task_status',
        'r.housekeeping_status as housekeeping_status',
        't.assigned_to as assigned_to',
        't.occupancy_id as occupancy_id',
        't.opened_at as opened_at',
        't.started_at as started_at',
        't.inspected_at as inspected_at',
      ])
      .where('t.status', '<>', 'DONE')
      .where('t.deleted_at', 'is', null);
    // Scope to the active property (used by the cockpit board) when supplied.
    if (propertyId) {
      query = query.where(
        'r.building_id',
        'in',
        this.db.selectFrom('buildings').select('id').where('property_id', '=', propertyId),
      );
    }
    return query.orderBy('t.opened_at', 'asc').execute();
  }

  // ── By-id scope lookups (room → building → property) ────────────────────────
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

  async taskPropertyId(taskId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('housekeeping_tasks as t')
      .leftJoin('rooms as r', 'r.id', 't.room_id')
      .leftJoin('buildings as b', 'b.id', 'r.building_id')
      .select('b.property_id as property_id')
      .where('t.id', '=', taskId)
      .where('t.deleted_at', 'is', null)
      .executeTakeFirst();
    return row?.property_id ?? null;
  }

  async findPaginated(query: HousekeepingQueryDTO, propertyId?: string) {
    let q = this.db.selectFrom('housekeeping_tasks').selectAll().where('deleted_at', 'is', null);
    let countQ = this.db
      .selectFrom('housekeeping_tasks')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null);

    // Scope to the active property: only tasks for rooms in that property.
    if (propertyId) {
      const roomsInProperty = this.db
        .selectFrom('rooms as r2')
        .innerJoin('buildings as b2', 'b2.id', 'r2.building_id')
        .select('r2.id')
        .where('b2.property_id', '=', propertyId);
      q = q.where('room_id', 'in', roomsInProperty);
      countQ = countQ.where('room_id', 'in', roomsInProperty);
    }

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
      q.limit(query.limit).offset(offset).orderBy('opened_at', 'desc').execute(),
      countQ.execute(),
    ]);

    return { data, total: Number(total), page: query.page, limit: query.limit };
  }

  /**
   * Open a turn task and mark the unit DIRTY. Called inside the check-out
   * transaction (so a departure atomically queues its own clean-up). Guarded by
   * the one-live-task-per-room partial unique index — a re-run is a no-op.
   */
  async openTaskOnCheckout(
    roomId: string,
    occupancyId: string,
    meta: HousekeepingRequestMeta,
    trx: DB
  ): Promise<void> {
    await trx
      .updateTable('rooms')
      .set({ housekeeping_status: 'DIRTY', updated_by: meta.userId, updated_at: sql`now()` })
      .where('id', '=', roomId)
      .execute();

    const inserted = await trx
      .insertInto('housekeeping_tasks')
      .values({
        room_id: roomId,
        occupancy_id: occupancyId,
        status: 'OPEN',
        created_by: meta.userId,
        updated_by: meta.userId,
      })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();

    await trx.insertInto('audit_logs').values({
      request_id: meta.requestId ?? null,
      user_id: meta.userId,
      action: 'UPDATE',
      entity: 'rooms',
      entity_id: roomId,
      diff: { housekeeping_status: 'DIRTY' },
    }).execute();

    if (inserted) {
      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'housekeeping_tasks',
        entity_id: inserted.id,
        diff: inserted,
      }).execute();
    }
  }

  // ── Compliance checklist (migration 056) ────────────────────────────────────

  /** The cleaning standard, in display order. activeOnly for the gate + cleaner UI. */
  async listChecklistItems(activeOnly: boolean): Promise<HousekeepingChecklistItemRow[]> {
    let q = this.db.selectFrom('housekeeping_checklist_items').selectAll();
    if (activeOnly) q = q.where('active', '=', true);
    return q.orderBy('sort_order', 'asc').orderBy('created_at', 'asc').execute();
  }

  async createChecklistItem(label: string, sortOrder: number, meta: HousekeepingRequestMeta): Promise<HousekeepingChecklistItemRow> {
    return this.db
      .insertInto('housekeeping_checklist_items')
      .values({ label, sort_order: sortOrder, created_by: meta.userId, updated_by: meta.userId })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateChecklistItem(
    id: string,
    patch: { label?: string; sort_order?: number; active?: boolean },
    meta: HousekeepingRequestMeta,
  ): Promise<HousekeepingChecklistItemRow | undefined> {
    return this.db
      .updateTable('housekeeping_checklist_items')
      .set({ ...patch, updated_by: meta.userId, updated_at: sql`now()` })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /** Item ids already ticked on a task. */
  async checkedItemIds(taskId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('housekeeping_task_checks')
      .select('item_id')
      .where('task_id', '=', taskId)
      .execute();
    return rows.map((r) => r.item_id);
  }

  /** Tick an item (idempotent) or untick it (delete). */
  async setCheck(taskId: string, itemId: string, checked: boolean, meta: HousekeepingRequestMeta): Promise<void> {
    if (checked) {
      await this.db
        .insertInto('housekeeping_task_checks')
        .values({ task_id: taskId, item_id: itemId, checked_by: meta.userId })
        .onConflict((oc) => oc.columns(['task_id', 'item_id']).doNothing())
        .execute();
    } else {
      await this.db
        .deleteFrom('housekeeping_task_checks')
        .where('task_id', '=', taskId)
        .where('item_id', '=', itemId)
        .execute();
    }
  }

  /** Active checklist items NOT yet ticked on a task — the compliance gate. */
  async uncheckedItems(taskId: string): Promise<HousekeepingChecklistItemRow[]> {
    return this.db
      .selectFrom('housekeeping_checklist_items as i')
      .selectAll('i')
      .where('i.active', '=', true)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('housekeeping_task_checks as c')
              .select('c.item_id')
              .whereRef('c.item_id', '=', 'i.id')
              .where('c.task_id', '=', taskId),
          ),
        ),
      )
      .orderBy('i.sort_order', 'asc')
      .execute();
  }

  // ── Turnaround tracking ──────────────────────────────────────────────────────

  /**
   * How long turns take in a property: completed tasks in the window, averaged
   * from DIRTY (opened_at) to signed-off READY (completed_at).
   */
  async turnaround(propertyId: string, days: number): Promise<{ completed: number; avg_minutes: number | null }> {
    const row = await this.db
      .selectFrom('housekeeping_tasks as t')
      .innerJoin('rooms as r', 'r.id', 't.room_id')
      .innerJoin('buildings as b', 'b.id', 'r.building_id')
      .select([
        sql<number>`count(t.id)`.as('completed'),
        sql<number | null>`round(avg(extract(epoch from (t.completed_at - t.opened_at)) / 60))`.as('avg_minutes'),
      ])
      .where('b.property_id', '=', propertyId)
      .where('t.status', '=', 'DONE')
      .where('t.completed_at', 'is not', null)
      .where('t.completed_at', '>=', sql<Date>`now() - make_interval(days => ${days})`)
      .where('t.deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    return { completed: Number(row.completed), avg_minutes: row.avg_minutes == null ? null : Number(row.avg_minutes) };
  }

  /**
   * Advance a task and the unit's readiness together, atomically.
   * `taskPatch` carries the new task status + the relevant timestamp; `roomStatus`
   * is the new unit readiness. Returns the updated task.
   */
  async transition(
    taskId: string,
    roomId: string,
    fromStatus: HousekeepingTaskStatus,
    taskPatch: Record<string, unknown>,
    roomStatus: HousekeepingStatus,
    meta: HousekeepingRequestMeta
  ): Promise<HousekeepingTaskRow> {
    return this.db.transaction().execute(async (trx) => {
      const task = await trx
        .updateTable('housekeeping_tasks')
        .set({ ...taskPatch, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', taskId)
        .where('status', '=', fromStatus)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('rooms')
        .set({ housekeeping_status: roomStatus, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', roomId)
        .execute();

      await trx.insertInto('audit_logs').values([
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'housekeeping_tasks', entity_id: taskId, diff: taskPatch },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'rooms', entity_id: roomId, diff: { housekeeping_status: roomStatus } },
      ]).execute();

      return task;
    });
  }
}
