import { Kysely, sql } from 'kysely';
import type { Database, PaymentIntentRow, NewPaymentIntent, PaymentAttemptRow, NewAuditLog } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { PaymentFilters, PaymentMethod, PaymentRequestMeta, PaymentListRow } from './payments.types.js';

interface AttemptParams {
  intentId: string;
  holdId: string;
  reservationId?: string | null;
  attemptNo: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  lastError?: string | null;
  heldUntil?: Date;
}

export class PaymentsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<PaymentIntentRow | undefined> {
    return this.db.selectFrom('payment_intents').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async listAttempts(intentId: string): Promise<PaymentAttemptRow[]> {
    return this.db
      .selectFrom('payment_attempts')
      .selectAll()
      .where('payment_intent_id', '=', intentId)
      .orderBy('attempt_no', 'asc')
      .execute();
  }

  async findPaginated(
    filters: PaymentFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<PaymentIntentRow & PaymentListRow>> {
    // Whose payment this is. An intent hangs off a hold, and the hold knows the
    // reservation (and, failing that, the unit) — without this the list is a row of
    // UUIDs and you cannot tell which guest's payment failed.
    //
    // Alias `ph`, not `h`: the property filter below opens its own `holds h` subquery,
    // and an outer alias shadowed by an inner one is legal SQL that reads like a bug.
    let query = this.db
      .selectFrom('payment_intents')
      .leftJoin('holds as ph', 'ph.id', 'payment_intents.hold_id')
      .leftJoin('reservations as rsv', 'rsv.id', 'ph.reservation_id')
      .leftJoin('contacts as c', 'c.id', 'rsv.contact_id')
      // The unit comes from the reservation when there is one, else straight off the hold.
      .leftJoin('rooms as rm', (join) => join.on(sql<boolean>`rm.id = coalesce(rsv.room_id, ph.room_id)`))
      .selectAll('payment_intents')
      .select([
        sql<string | null>`c.name`.as('guest_name'),
        sql<string | null>`rm.code`.as('unit_code'),
        sql<string | null>`rsv.id`.as('reservation_id'),
      ]);
    let countQuery = this.db.selectFrom('payment_intents').select(this.db.fn.count<number>('id').as('total'));

    // Qualified on the joined query: `status` now exists on intents, holds AND
    // reservations, so an unqualified name is ambiguous to Postgres.
    if (filters.status) {
      query = query.where('payment_intents.status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
    }
    if (filters.hold_id) {
      query = query.where('payment_intents.hold_id', '=', filters.hold_id);
      countQuery = countQuery.where('hold_id', '=', filters.hold_id);
    }

    if (filters.property_id) {
      // Property via the intent's hold -> room (or the hold's reservation's room).
      const inProperty = sql<boolean>`exists (
        select 1 from holds h
        join rooms r on r.id = coalesce(
          h.room_id,
          (select res.room_id from reservations res where res.id = h.reservation_id)
        )
        join buildings b on b.id = r.building_id
        where h.id = payment_intents.hold_id and b.property_id = ${filters.property_id}
      )`;
      query = query.where(inProperty);
      countQuery = countQuery.where(inProperty);
    }

    const offset = (pagination.page - 1) * pagination.limit;
    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('payment_intents.created_at', 'desc').execute(),
      countQuery.execute(),
    ]);

    return { data, total: Number(total), page: pagination.page, limit: pagination.limit };
  }

  async create(intent: NewPaymentIntent, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('payment_intents')
        .values(intent)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'payment_intents',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();

      return inserted;
    });
  }

  // SUCCESS: record attempt, mark intent PAID, confirm the hold — atomically.
  async settlePaid(params: AttemptParams, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    return this.db.transaction().execute(async (trx) => {
      await this.insertAttempt(trx, params, 'SUCCESS', meta);

      const intent = await trx
        .updateTable('payment_intents')
        .set({ status: 'PAID', attempts: sql`attempts + 1`, paid_at: sql`now()`, last_error: null, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', params.intentId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('holds')
        .set({ status: 'CONFIRMED', updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', params.holdId)
        .where('status', '=', 'HELD')
        .execute();

      const auditRows: NewAuditLog[] = [
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'payment_intents', entity_id: params.intentId, diff: { status: 'PAID' }, ip_address: meta.ip ?? null },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'holds', entity_id: params.holdId, diff: { status: 'CONFIRMED' }, ip_address: meta.ip ?? null },
      ];

      // Close the money loop: a paid hold confirms its linked reservation.
      // Guarded so a re-run or a non-PENDING reservation is a safe no-op.
      if (params.reservationId) {
        const confirmed = await trx
          .updateTable('reservations')
          .set({ status: 'CONFIRMED', updated_by: meta.userId, updated_at: sql`now()` })
          .where('id', '=', params.reservationId)
          .where('status', '=', 'PENDING')
          .where('deleted_at', 'is', null)
          .returning('id')
          .executeTakeFirst();

        if (confirmed) {
          auditRows.push({ request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'reservations', entity_id: params.reservationId, diff: { status: 'CONFIRMED' }, ip_address: meta.ip ?? null });
        }
      }

      await trx.insertInto('audit_logs').values(auditRows).execute();

      return intent;
    });
  }

  // FAILURE with attempts remaining: RETRY, keep the hold, extend its window.
  async recordRetry(params: AttemptParams, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    return this.db.transaction().execute(async (trx) => {
      await this.insertAttempt(trx, params, 'FAILURE', meta);

      const intent = await trx
        .updateTable('payment_intents')
        .set({ status: 'RETRY', attempts: sql`attempts + 1`, last_error: params.lastError ?? null, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', params.intentId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('holds')
        .set({ retry_count: sql`retry_count + 1`, held_until: params.heldUntil!, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', params.holdId)
        .where('status', '=', 'HELD')
        .execute();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'UPDATE',
        entity: 'payment_intents',
        entity_id: params.intentId,
        diff: { status: 'RETRY', attempts: intent.attempts },
        ip_address: meta.ip ?? null,
      }).execute();

      return intent;
    });
  }

  // FAILURE with attempts exhausted: FAILED, release the hold (retry-before-release).
  async settleFailed(params: AttemptParams, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    return this.db.transaction().execute(async (trx) => {
      await this.insertAttempt(trx, params, 'FAILURE', meta);

      const intent = await trx
        .updateTable('payment_intents')
        .set({ status: 'FAILED', attempts: sql`attempts + 1`, last_error: params.lastError ?? null, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', params.intentId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('holds')
        .set({ status: 'RELEASED', release_reason: 'payment_failed', updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', params.holdId)
        .where('status', '=', 'HELD')
        .execute();

      await trx.insertInto('audit_logs').values([
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'payment_intents', entity_id: params.intentId, diff: { status: 'FAILED' }, ip_address: meta.ip ?? null },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'holds', entity_id: params.holdId, diff: { status: 'RELEASED', release_reason: 'payment_failed' }, ip_address: meta.ip ?? null },
      ]).execute();

      return intent;
    });
  }

  private async insertAttempt(
    trx: Kysely<Database>,
    params: AttemptParams,
    outcome: 'SUCCESS' | 'FAILURE',
    meta: PaymentRequestMeta
  ): Promise<void> {
    await trx
      .insertInto('payment_attempts')
      .values({
        payment_intent_id: params.intentId,
        attempt_no: params.attemptNo,
        outcome,
        method: params.method,
        reference: params.reference,
        note: params.note,
        created_by: meta.userId,
      })
      .execute();
  }
}
