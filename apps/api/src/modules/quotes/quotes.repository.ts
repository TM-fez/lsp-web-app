import { Kysely, sql } from 'kysely';
import type { Database, QuoteRow, NewQuote } from '../../db/types.js';
import { inTransaction } from '../../core/db/transaction.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { QuoteFilters, QuoteStatus, QuoteRequestMeta, QuoteScope } from './quotes.types.js';

/** SQL for "may this caller see this quote" — shared by the list and by-id reads. */
export function quoteVisibleSql(scope: QuoteScope | undefined) {
  if (!scope || scope.allProperties) return sql<boolean>`true`;
  const ids = scope.ids ?? [];
  const heldInMine =
    ids.length === 0
      ? sql<boolean>`false`
      : sql<boolean>`EXISTS (
          SELECT 1 FROM holds qh
            LEFT JOIN reservations qres ON qres.id = qh.reservation_id
            JOIN rooms qr ON qr.id = coalesce(qh.room_id, qres.room_id)
            JOIN buildings qb ON qb.id = qr.building_id
           WHERE qh.quote_id = quotes.id AND qb.property_id IN (${sql.join(ids)})
        )`;
  return sql<boolean>`(quotes.created_by = ${scope.userId} OR ${heldInMine})`;
}

export class QuotesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string, scope?: QuoteScope): Promise<QuoteRow | undefined> {
    return this.db.selectFrom('quotes').selectAll().where('id', '=', id).where(quoteVisibleSql(scope)).executeTakeFirst();
  }

  async findPaginated(
    filters: QuoteFilters,
    pagination: PaginationOptions,
    scope?: QuoteScope
  ): Promise<PaginatedResult<QuoteRow>> {
    let query = this.db.selectFrom('quotes').selectAll().where(quoteVisibleSql(scope));
    let countQuery = this.db.selectFrom('quotes').select(this.db.fn.count<number>('id').as('total')).where(quoteVisibleSql(scope));

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
    return inTransaction(this.db, async (trx) => {
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
