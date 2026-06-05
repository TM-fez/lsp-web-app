import { Kysely, sql } from 'kysely';
import type { Database, LeadRow, NewLead, UpdateLead } from '../../../../db/types';
import type { LeadFilters, LeadPaginationOptions, PaginatedLeadResult, LeadRequestMeta } from './leads.types';

export class LeadsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<LeadRow | undefined> {
    return this.db
      .selectFrom('leads')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async findPaginated(
    filters: LeadFilters,
    pagination: LeadPaginationOptions
  ): Promise<PaginatedLeadResult<LeadRow>> {
    let query = this.db
      .selectFrom('leads')
      .selectAll()
      .where('deleted_at', 'is', null);

    let countQuery = this.db
      .selectFrom('leads')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
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
