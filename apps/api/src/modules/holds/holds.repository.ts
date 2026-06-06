import { Kysely, sql } from 'kysely';
import type { Database, HoldRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { HoldFilters, HoldStatus, HoldRequestMeta } from './holds.types.js';

interface CreateHoldParams {
  quoteId: string;
  roomId: string | null;
  reservationId: string | null;
  heldUntil: Date;
}

export class HoldsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<HoldRow | undefined> {
    return this.db
      .selectFrom('holds')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  async findPaginated(
    filters: HoldFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<HoldRow>> {
    let query = this.db.selectFrom('holds').selectAll().where('deleted_at', 'is', null);
    let countQuery = this.db
      .selectFrom('holds')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
    }
    if (filters.quote_id) {
      query = query.where('quote_id', '=', filters.quote_id);
      countQuery = countQuery.where('quote_id', '=', filters.quote_id);
    }

    const offset = (pagination.page - 1) * pagination.limit;
    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('created_at', 'desc').execute(),
      countQuery.execute(),
    ]);

    return { data, total: Number(total), page: pagination.page, limit: pagination.limit };
  }

  /**
   * Create a hold and consume its quote atomically. The partial unique index
   * `holds_active_quote_unique` is the real guard against two live holds on one
   * quote — occupancy is protected by the database, not by app timing.
   */
  async create(params: CreateHoldParams, meta: HoldRequestMeta): Promise<HoldRow> {
    return this.db.transaction().execute(async (trx) => {
      const hold = await trx
        .insertInto('holds')
        .values({
          quote_id: params.quoteId,
          room_id: params.roomId,
          reservation_id: params.reservationId,
          status: 'HELD',
          held_until: params.heldUntil,
          created_by: meta.userId,
          updated_by: meta.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('quotes')
        .set({ status: 'CONSUMED', updated_at: sql`now()` })
        .where('id', '=', params.quoteId)
        .where('status', '=', 'ACTIVE')
        .execute();

      await trx.insertInto('audit_logs').values([
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'CREATE', entity: 'holds', entity_id: hold.id, diff: hold, ip_address: meta.ip ?? null },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'quotes', entity_id: params.quoteId, diff: { status: 'CONSUMED' }, ip_address: meta.ip ?? null },
      ]).execute();

      return hold;
    });
  }

  async markStatus(
    id: string,
    status: HoldStatus,
    releaseReason: string | null,
    meta: HoldRequestMeta
  ): Promise<HoldRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('holds')
        .set({ status, release_reason: releaseReason, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'holds',
          entity_id: id,
          diff: { status, release_reason: releaseReason },
          ip_address: meta.ip ?? null,
        }).execute();
      }
      return updated;
    });
  }

  // Retry-before-release: bump the retry counter and extend the hold window.
  async incrementRetry(id: string, heldUntil: Date, meta: HoldRequestMeta): Promise<HoldRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('holds')
        .set({ retry_count: sql`retry_count + 1`, held_until: heldUntil, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'holds',
          entity_id: id,
          diff: { retry_count: updated.retry_count, held_until: heldUntil },
          ip_address: meta.ip ?? null,
        }).execute();
      }
      return updated;
    });
  }

  // Auto/smart release: expire HELD rows past their window in one statement.
  async releaseExpired(): Promise<number> {
    const res = await this.db
      .updateTable('holds')
      .set({ status: 'EXPIRED', release_reason: 'auto-expired', updated_at: sql`now()` })
      .where('status', '=', 'HELD')
      .where('held_until', '<', sql<Date>`now()`)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(res.numUpdatedRows ?? 0);
  }
}
