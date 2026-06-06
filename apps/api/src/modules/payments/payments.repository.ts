import { Kysely, sql } from 'kysely';
import type { Database, PaymentIntentRow, NewPaymentIntent, PaymentAttemptRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { PaymentFilters, PaymentMethod, PaymentRequestMeta } from './payments.types.js';

interface AttemptParams {
  intentId: string;
  holdId: string;
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
  ): Promise<PaginatedResult<PaymentIntentRow>> {
    let query = this.db.selectFrom('payment_intents').selectAll();
    let countQuery = this.db.selectFrom('payment_intents').select(this.db.fn.count<number>('id').as('total'));

    if (filters.status) {
      query = query.where('status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
    }
    if (filters.hold_id) {
      query = query.where('hold_id', '=', filters.hold_id);
      countQuery = countQuery.where('hold_id', '=', filters.hold_id);
    }

    const offset = (pagination.page - 1) * pagination.limit;
    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('created_at', 'desc').execute(),
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

      await trx.insertInto('audit_logs').values([
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'payment_intents', entity_id: params.intentId, diff: { status: 'PAID' }, ip_address: meta.ip ?? null },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'holds', entity_id: params.holdId, diff: { status: 'CONFIRMED' }, ip_address: meta.ip ?? null },
      ]).execute();

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
