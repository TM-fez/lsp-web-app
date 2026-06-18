import { Kysely, sql } from 'kysely';
import type { Database, NewOperatingExpense, UpdateOperatingExpense } from '../../db/types.js';
import type { OperatingExpenseFilters, OperatingExpensesRequestMeta } from './operating-expenses.types.js';

export class OperatingExpensesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private base() {
    return this.db
      .selectFrom('operating_expenses as oe')
      .leftJoin('properties as p', 'p.id', 'oe.property_id')
      .select([
        'oe.id', 'oe.property_id', 'oe.category', 'oe.description', 'oe.vendor',
        'oe.amount', 'oe.currency', 'oe.incurred_on', 'oe.notes',
        'oe.created_at', 'oe.updated_at', 'p.name as property_name',
      ])
      .where('oe.deleted_at', 'is', null);
  }

  async list(filters: OperatingExpenseFilters) {
    let q = this.base();
    if (filters.property_id) q = q.where('oe.property_id', '=', filters.property_id);
    if (filters.category) q = q.where('oe.category', '=', filters.category);
    if (filters.from) q = q.where('oe.incurred_on', '>=', new Date(filters.from));
    if (filters.to) q = q.where('oe.incurred_on', '<=', new Date(filters.to));
    return q.orderBy('oe.incurred_on', 'desc').orderBy('oe.created_at', 'desc').execute();
  }

  async findById(id: string) {
    return this.base().where('oe.id', '=', id).executeTakeFirst();
  }

  private async audit(
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    id: string,
    diff: unknown,
    meta: OperatingExpensesRequestMeta,
  ) {
    await this.db
      .insertInto('audit_logs')
      .values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action,
        entity: 'operating_expense',
        entity_id: id,
        diff: JSON.stringify(diff),
        ip_address: meta.ip ?? null,
      })
      .execute();
  }

  async create(values: NewOperatingExpense, meta: OperatingExpensesRequestMeta) {
    const row = await this.db
      .insertInto('operating_expenses')
      .values(values)
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.audit('CREATE', row.id, values, meta);
    return this.findById(row.id);
  }

  async update(id: string, patch: UpdateOperatingExpense, meta: OperatingExpensesRequestMeta) {
    const row = await this.db
      .updateTable('operating_expenses')
      .set({ ...patch, updated_by: meta.userId, updated_at: sql`now()` })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!row) return undefined;
    await this.audit('UPDATE', id, patch, meta);
    return this.findById(id);
  }

  async softDelete(id: string, meta: OperatingExpensesRequestMeta) {
    const row = await this.db
      .updateTable('operating_expenses')
      .set({ deleted_at: sql`now()`, deleted_by: meta.userId })
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!row) return false;
    await this.audit('DELETE', id, {}, meta);
    return true;
  }
}
