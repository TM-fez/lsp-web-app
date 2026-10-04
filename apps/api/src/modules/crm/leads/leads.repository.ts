import { Kysely, sql } from 'kysely';
import type { Database, LeadRow, NewLead, UpdateLead } from '../../../db/types.js';
import type { LeadFilters, LeadPaginationOptions, PaginatedLeadResult, LeadRequestMeta, LeadScope } from './leads.types.js';

/** SQL for "may this caller see this lead" — one rule for the list, by-id, edit and delete. */
export function leadVisibleSql(scope: LeadScope | undefined) {
  if (!scope || scope.allProperties) return sql<boolean>`true`;
  const ids = scope.ids ?? [];
  const mine = ids.length === 0 ? sql<boolean>`false` : sql<boolean>`leads.property_id IN (${sql.join(ids)})`;
  return sql<boolean>`(${mine} OR (leads.property_id IS NULL AND leads.created_by = ${scope.userId}))`;
}

export class LeadsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string, scope?: LeadScope): Promise<LeadRow | undefined> {
    return this.db
      .selectFrom('leads')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .where(leadVisibleSql(scope))
      .executeTakeFirst();
  }

  async findPaginated(
    filters: LeadFilters,
    pagination: LeadPaginationOptions,
    scope?: LeadScope
  ): Promise<PaginatedLeadResult<LeadRow>> {
    let query = this.db
      .selectFrom('leads')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where(leadVisibleSql(scope));

    let countQuery = this.db
      .selectFrom('leads')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null)
      .where(leadVisibleSql(scope));

    if (filters.status) {
      query = query.where('status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
    }

    if (filters.source) {
      query = query.where('source', '=', filters.source);
      countQuery = countQuery.where('source', '=', filters.source);
    }

    if (filters.search) {
      const searchPattern = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('title', 'ilike', searchPattern),
          eb('description', 'ilike', searchPattern),
        ])
      );
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('title', 'ilike', searchPattern),
          eb('description', 'ilike', searchPattern),
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

  async create(lead: NewLead, meta: LeadRequestMeta): Promise<LeadRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('leads')
        .values(lead)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'leads',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();

      return inserted;
    });
  }

  async update(id: string, update: UpdateLead, meta: LeadRequestMeta): Promise<LeadRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('leads')
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
          entity: 'leads',
          entity_id: id,
          diff: update,
          ip_address: meta.ip ?? null,
        }).execute();
      }

      return updated;
    });
  }

  /**
   * (Re-test round 3) Claim an enquiry for conversion — one caller only. Five parallel
   * "Convert to booking" clicks each read "not converted yet" and each made a booking
   * (four landed). The claim is a single conditional UPDATE: only the first flips the
   * status; everyone else gets undefined. Returns the status it had, so a conversion
   * that then fails can put it back (`releaseConversion`).
   */
  async claimForConversion(id: string, contactId: string, meta: LeadRequestMeta): Promise<{ previousStatus: LeadRow['status'] } | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('leads').select('status').where('id', '=', id)
        .where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
      if (!before || before.status === 'CONVERTED' || before.status === 'LOST') return undefined;
      await trx.updateTable('leads')
        .set({ status: 'CONVERTED', contact_id: contactId, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', id).execute();
      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'leads', entity_id: id,
        diff: { status: { from: before.status, to: 'CONVERTED' }, contact_id: contactId }, ip_address: meta.ip ?? null,
      }).execute();
      return { previousStatus: before.status };
    });
  }

  async softDelete(id: string, meta: LeadRequestMeta): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const deleted = await trx
        .updateTable('leads')
        .set({ 
          deleted_at: sql`now()`,
          deleted_by: meta.userId
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
          entity: 'leads',
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
