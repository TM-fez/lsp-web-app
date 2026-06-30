import { Kysely, sql } from 'kysely';
import type { Database, NewOperatingExpense, UpdateOperatingExpense, NewRecurringCost, UpdateRecurringCost } from '../../db/types.js';
import type { OperatingExpenseFilters, OperatingExpensesRequestMeta } from './operating-expenses.types.js';

// Sentinel id used to make an "in" match nothing when the caller has no properties.
const NO_PROPERTY = '00000000-0000-0000-0000-000000000000';

export class OperatingExpensesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  private base() {
    return this.db
      .selectFrom('operating_expenses as oe')
      .leftJoin('properties as p', 'p.id', 'oe.property_id')
      .leftJoin('files as f', 'f.id', 'oe.receipt_file_id')
      .select([
        'oe.id', 'oe.property_id', 'oe.category', 'oe.description', 'oe.vendor',
        'oe.amount', 'oe.currency', 'oe.notes',
        'oe.receipt_file_id', 'f.original_name as receipt_name',
        'oe.created_at', 'oe.updated_at', 'p.name as property_name',
        // incurred_on is a pure calendar DATE — return it as 'YYYY-MM-DD' text so
        // the Africa/Gaborone session timezone can't shift it a day on read.
        sql<string>`to_char(oe.incurred_on, 'YYYY-MM-DD')`.as('incurred_on'),
      ])
      .where('oe.deleted_at', 'is', null);
  }

  async list(filters: OperatingExpenseFilters) {
    let q = this.base();
    // Access scope: non-admins see only their properties (admin passes null → all).
    // An empty set uses a sentinel id so the IN matches nothing.
    if (filters.accessiblePropertyIds) {
      const ids = filters.accessiblePropertyIds.length > 0 ? filters.accessiblePropertyIds : [NO_PROPERTY];
      q = q.where('oe.property_id', 'in', ids);
    }
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

  // ── Recurring templates ─────────────────────────────────────────────────────
  private recurringBase() {
    return this.db
      .selectFrom('recurring_operating_costs as rc')
      .leftJoin('properties as p', 'p.id', 'rc.property_id')
      .select([
        'rc.id', 'rc.property_id', 'rc.category', 'rc.description', 'rc.vendor',
        'rc.amount', 'rc.day_of_month', 'rc.active', 'rc.notes', 'p.name as property_name',
      ])
      .where('rc.deleted_at', 'is', null);
  }

  listRecurring(accessibleIds?: string[] | null) {
    let q = this.recurringBase();
    if (accessibleIds) {
      const ids = accessibleIds.length > 0 ? accessibleIds : [NO_PROPERTY];
      q = q.where('rc.property_id', 'in', ids);
    }
    return q.orderBy('rc.category').orderBy('rc.description').execute();
  }

  findRecurring(id: string) {
    return this.recurringBase().where('rc.id', '=', id).executeTakeFirst();
  }

  private async auditRecurring(action: 'CREATE' | 'UPDATE' | 'DELETE', id: string, diff: unknown, meta: OperatingExpensesRequestMeta) {
    await this.db.insertInto('audit_logs').values({
      request_id: meta.requestId ?? null,
      user_id: meta.userId,
      action,
      entity: 'recurring_operating_cost',
      entity_id: id,
      diff: JSON.stringify(diff),
      ip_address: meta.ip ?? null,
    }).execute();
  }

  async createRecurring(values: NewRecurringCost, meta: OperatingExpensesRequestMeta) {
    const row = await this.db.insertInto('recurring_operating_costs').values(values).returning('id').executeTakeFirstOrThrow();
    await this.auditRecurring('CREATE', row.id, values, meta);
    return this.findRecurring(row.id);
  }

  async updateRecurring(id: string, patch: UpdateRecurringCost, meta: OperatingExpensesRequestMeta) {
    const row = await this.db
      .updateTable('recurring_operating_costs')
      .set({ ...patch, updated_by: meta.userId, updated_at: sql`now()` })
      .where('id', '=', id).where('deleted_at', 'is', null)
      .returning('id').executeTakeFirst();
    if (!row) return undefined;
    await this.auditRecurring('UPDATE', id, patch, meta);
    return this.findRecurring(id);
  }

  async softDeleteRecurring(id: string, meta: OperatingExpensesRequestMeta) {
    const row = await this.db
      .updateTable('recurring_operating_costs')
      .set({ deleted_at: sql`now()`, deleted_by: meta.userId })
      .where('id', '=', id).where('deleted_at', 'is', null)
      .returning('id').executeTakeFirst();
    if (!row) return false;
    await this.auditRecurring('DELETE', id, {}, meta);
    return true;
  }

  // Generate one operating_expenses row per active template for `month` (YYYY-MM),
  // skipping any already generated (tagged 'recurring:<templateId>:<month>').
  async generateForMonth(month: string, meta: OperatingExpensesRequestMeta) {
    const templates = await this.db
      .selectFrom('recurring_operating_costs')
      .selectAll().where('active', '=', true).where('deleted_at', 'is', null).execute();
    let created = 0, skipped = 0;
    for (const t of templates) {
      const tag = `recurring:${t.id}:${month}`;
      const exists = await this.db.selectFrom('operating_expenses').select('id')
        .where('notes', '=', tag).where('deleted_at', 'is', null).executeTakeFirst();
      if (exists) { skipped++; continue; }
      const dd = String(Math.min(28, t.day_of_month)).padStart(2, '0');
      const ins = await this.db.insertInto('operating_expenses').values({
        property_id: t.property_id,
        category: t.category,
        description: t.description,
        vendor: t.vendor,
        amount: t.amount,
        currency: 'BWP',
        incurred_on: new Date(`${month}-${dd}T00:00:00Z`),
        notes: tag,
        created_by: meta.userId,
        updated_by: meta.userId,
      }).returning('id').executeTakeFirstOrThrow();
      await this.audit('CREATE', ins.id, { recurring: t.id, month }, meta);
      created++;
    }
    return { created, skipped, templates: templates.length };
  }
}
