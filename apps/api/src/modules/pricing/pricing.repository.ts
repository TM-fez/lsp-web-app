import { Kysely, sql } from 'kysely';
import type { Database, RatePlanRow, NewRatePlan, UpdateRatePlan } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { RatePlanFilters, PricingRequestMeta } from './pricing.types.js';

export class PricingRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<RatePlanRow | undefined> {
    return this.db
      .selectFrom('rate_plans')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  // The single active plan that the quote engine resolves for a unit type.
  async findActiveByUnitType(unitType: RatePlanRow['unit_type']): Promise<RatePlanRow | undefined> {
    return this.db
      .selectFrom('rate_plans')
      .selectAll()
      .where('unit_type', '=', unitType)
      .where('active', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async findPaginated(
    filters: RatePlanFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<RatePlanRow>> {
    // LEFT-join the editor so the screen can show "Updated by <name>" — price
    // changes shouldn't be a surprise to the rest of the team.
    let query = this.db
      .selectFrom('rate_plans as rp')
      .leftJoin('users as editor', 'editor.id', 'rp.updated_by')
      .selectAll('rp')
      .select('editor.name as updated_by_name')
      .where('rp.deleted_at', 'is', null);
    let countQuery = this.db
      .selectFrom('rate_plans')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null);

    if (filters.unit_type) {
      query = query.where('rp.unit_type', '=', filters.unit_type);
      countQuery = countQuery.where('unit_type', '=', filters.unit_type);
    }
    if (filters.active !== undefined) {
      query = query.where('rp.active', '=', filters.active);
      countQuery = countQuery.where('active', '=', filters.active);
    }

    const offset = (pagination.page - 1) * pagination.limit;
    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('rp.created_at', 'desc').execute(),
      countQuery.execute(),
    ]);

    return { data, total: Number(total), page: pagination.page, limit: pagination.limit };
  }

  async create(plan: NewRatePlan, meta: PricingRequestMeta): Promise<RatePlanRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('rate_plans')
        .values(plan)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'rate_plans',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();

      return inserted;
    });
  }

  async update(id: string, update: UpdateRatePlan, meta: PricingRequestMeta): Promise<RatePlanRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('rate_plans')
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
          entity: 'rate_plans',
          entity_id: id,
          diff: update,
          ip_address: meta.ip ?? null,
        }).execute();
      }

      return updated;
    });
  }

  async softDelete(id: string, meta: PricingRequestMeta): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const deleted = await trx
        .updateTable('rate_plans')
        .set({ deleted_at: sql`now()`, deleted_by: meta.userId, active: false })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (deleted) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'DELETE',
          entity: 'rate_plans',
          entity_id: id,
          diff: { deleted_at: deleted.deleted_at },
          ip_address: meta.ip ?? null,
        }).execute();
        return true;
      }
      return false;
    });
  }
}
