import { Kysely, sql } from 'kysely';
import type { Database, HoldRow } from '../../db/types.js';
import { inTransaction } from '../../core/db/transaction.js';
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
    if (filters.property_id) {
      // Property via the pinned room, falling back to the reservation's room.
      const inProperty = sql<boolean>`exists (
        select 1 from rooms r
        join buildings b on b.id = r.building_id
        where r.id = coalesce(
          holds.room_id,
          (select res.room_id from reservations res where res.id = holds.reservation_id)
        )
        and b.property_id = ${filters.property_id}
      )`;
      query = query.where(inProperty);
      countQuery = countQuery.where(inProperty);
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
    return inTransaction(this.db, async (trx) => {
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

  /**
   * Auto/smart release: expire HELD rows past their window.
   *
   * - No `scope` = the scheduled system sweep: every expired hold in the house, as before.
   * - With `scope` = a person pressing the button (POST /holds/sweep/release-expired):
   *   (N-NEW-13) only holds in `propertyIds` (null = every property), and each released
   *   hold gets its own audit row in the same transaction, so "who released these?" has an
   *   answer. A hold that belongs to no property (no room, no booking) is only released by
   *   someone who can see every property.
   */
  async releaseExpired(scope?: { propertyIds: string[] | null; meta: HoldRequestMeta }): Promise<number> {
    if (!scope) {
      const res = await this.db
        .updateTable('holds')
        .set({ status: 'EXPIRED', release_reason: 'auto-expired', updated_at: sql`now()` })
        .where('status', '=', 'HELD')
        .where('held_until', '<', sql<Date>`now()`)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return Number(res.numUpdatedRows ?? 0);
    }

    const { propertyIds, meta } = scope;
    return this.db.transaction().execute(async (trx) => {
      let q = trx
        .updateTable('holds')
        .set({ status: 'EXPIRED', release_reason: 'auto-expired', updated_by: meta.userId, updated_at: sql`now()` })
        .where('status', '=', 'HELD')
        .where('held_until', '<', sql<Date>`now()`)
        .where('deleted_at', 'is', null);
      if (propertyIds !== null) {
        q = propertyIds.length === 0
          ? q.where(sql<boolean>`false`)
          : q.where(
              'id',
              'in',
              sql<string>`(
                SELECT h.id FROM holds h
                  LEFT JOIN reservations res ON res.id = h.reservation_id
                  LEFT JOIN rooms r ON r.id = coalesce(h.room_id, res.room_id)
                  LEFT JOIN buildings b ON b.id = r.building_id
                 WHERE b.property_id IN (${sql.join(propertyIds)})
              )`
            );
      }
      const released = await q.returning('id').execute();
      if (released.length > 0) {
        await trx.insertInto('audit_logs').values(
          released.map((h) => ({
            request_id: meta.requestId ?? null,
            user_id: meta.userId,
            action: 'UPDATE' as const,
            entity: 'holds',
            entity_id: h.id,
            diff: { status: 'EXPIRED', release_reason: 'auto-expired', via: 'manual sweep' },
            ip_address: meta.ip ?? null,
          }))
        ).execute();
      }
      return released.length;
    });
  }
}
