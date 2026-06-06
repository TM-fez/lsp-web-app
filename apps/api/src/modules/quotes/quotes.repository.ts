import { Kysely, sql } from 'kysely';
import type { Database, QuoteRow, NewQuote } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { QuoteFilters, QuoteStatus, QuoteRequestMeta } from './quotes.types.js';

export class QuotesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<QuoteRow | undefined> {
    return this.db.selectFrom('quotes').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async findPaginated(
    filters: QuoteFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<QuoteRow>> {
    let query = this.db.selectFrom('quotes').selectAll();
    let countQuery = this.db.selectFrom('quotes').select(this.db.fn.count<number>('id').as('total'));

    if (filters.status) {
      query = query.where('status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
    }
    if (filters.unit_type) {
      query = query.where('unit_type', '=', filters.unit_type);
      countQuery = countQuery.where('unit_type', '=', filters.unit_type);
    }

    const offset = (pagination.page - 1) * pagination.limit;
    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('created_at', 'desc').execute(),
      countQuery.execute(),
    ]);

    return { data, total: Number(total), page: pagination.page, limit: pagination.limit };
  }

  // Quotes are immutable: only creation writes the figures.
  async create(quote: NewQuote, meta: QuoteRequestMeta): Promise<QuoteRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('quotes')
        .values(quote)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'quotes',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();

      return inserted;
    });
  }

  // Status-only transition (EXPIRED / CONSUMED). Never mutates figures.
  async markStatus(id: string, status: QuoteStatus, meta: QuoteRequestMeta): Promise<QuoteRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('quotes')
        .set({ status, updated_at: sql`now()` })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();

      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'quotes',
          entity_id: id,
          diff: { status },
          ip_address: meta.ip ?? null,
        }).execute();
      }
      return updated;
    });
  }

  // Auto-expiry sweep: ACTIVE quotes past their TTL become EXPIRED.
  async expireStale(): Promise<number> {
    const res = await this.db
      .updateTable('quotes')
      .set({ status: 'EXPIRED', updated_at: sql`now()` })
      .where('status', '=', 'ACTIVE')
      .where('expires_at', '<', sql<Date>`now()`)
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0);
  }
}
