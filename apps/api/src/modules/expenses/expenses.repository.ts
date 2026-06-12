import { Kysely, sql } from 'kysely';
import type { Database } from '../../db/types.js';
import type { ExpenseStatus, ExpensesRequestMeta } from './expenses.types.js';

export class ExpensesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // Reads repair costs straight off the work orders, but lives behind expenses.*
  // perms so Accounts can use it WITHOUT any maintenance access.
  private base() {
    return this.db
      .selectFrom('maintenance_work_orders as wo')
      .leftJoin('rooms as r', 'r.id', 'wo.room_id')
      .leftJoin('users as appr', 'appr.id', 'wo.cost_approved_by')
      .leftJoin('users as rec', 'rec.id', 'wo.cost_reconciled_by')
      .select([
        'wo.id',
        'wo.room_id',
        'wo.title',
        'wo.contractor_name',
        'wo.cost_amount',
        'wo.cost_approved_at',
        'wo.cost_reconciled_at',
        'wo.opened_at',
        'r.code as room_code',
        'appr.name as cost_approved_by_name',
        'rec.name as cost_reconciled_by_name',
      ])
      .where('wo.cost_amount', 'is not', null)
      .where('wo.deleted_at', 'is', null);
  }

  async list(status?: ExpenseStatus) {
    let q = this.base();
    if (status === 'PENDING') q = q.where('wo.cost_approved_at', 'is', null);
    else if (status === 'APPROVED')
      q = q.where('wo.cost_approved_at', 'is not', null).where('wo.cost_reconciled_at', 'is', null);
    else if (status === 'RECONCILED') q = q.where('wo.cost_reconciled_at', 'is not', null);
    return q.orderBy('wo.opened_at', 'desc').execute();
  }

  async findById(id: string) {
    return this.db
      .selectFrom('maintenance_work_orders')
      .select(['id', 'cost_amount', 'cost_approved_at', 'cost_reconciled_at', 'deleted_at'])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  private async audit(id: string, action: string, meta: ExpensesRequestMeta) {
    await this.db
      .insertInto('audit_logs')
      .values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'UPDATE',
        entity: 'maintenance_expense',
        entity_id: id,
        diff: JSON.stringify({ [action]: true }),
        ip_address: meta.ip ?? null,
      })
      .execute();
  }

  async approveSpend(id: string, meta: ExpensesRequestMeta) {
    const row = await this.db
      .updateTable('maintenance_work_orders')
      .set({ cost_approved_by: meta.userId, cost_approved_at: sql`now()`, updated_at: sql`now()` })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit(id, 'spend_approved', meta);
    return row;
  }

  async reconcile(id: string, meta: ExpensesRequestMeta) {
    const row = await this.db
      .updateTable('maintenance_work_orders')
      .set({ cost_reconciled_by: meta.userId, cost_reconciled_at: sql`now()`, updated_at: sql`now()` })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit(id, 'reconciled', meta);
    return row;
  }
}
