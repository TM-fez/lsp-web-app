import { releaseReservationHolds } from '../holds/holds.release.js';
import { Kysely, sql } from 'kysely';
import type { Database, PaymentIntentRow, NewPaymentIntent, PaymentAttemptRow, NewAuditLog, NewQuote } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { PaymentFilters, PaymentMethod, PaymentRequestMeta, PaymentListRow } from './payments.types.js';
import { AppError } from '../../core/errors/AppError.js';
import { inTransaction } from '../../core/db/transaction.js';
import {
  agreedTotal,
  describeThebe,
  lockReservation,
  paidToDate,
  TERMINAL_RESERVATION_STATUSES,
} from '../../core/money/folio.js';
import { invoicePropertyIdSql } from '../../core/scope/invoiceProperty.js';
import { insertReceipt, reconcileReceivable } from '../invoices/invoices.receivable.js';
import { QuotesRepository } from '../quotes/quotes.repository.js';
import { HoldsRepository } from '../holds/holds.repository.js';

export interface DeskPaymentParams {
  reservationId: string;
  roomId: string;
  /** The priced quote, built (not written) by QuotesService.prepareQuote. */
  quote: NewQuote;
  /** What the folio would say if nothing were frozen yet — the quote's total. */
  pricedTotal: number;
  /** Thebe received; omitted = the whole outstanding balance. */
  amount?: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  holdTtlMs: number;
}

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
      // A payment recorded by settling an invoice has NO hold (migration 071) — it hangs
      // off the invoice instead, and the invoice knows the booking. Without this chain
      // those rows would list with no guest and drop out of every property filter, which
      // is exactly how the Payments page and the Invoices page came to disagree.
      .leftJoin('invoices as pinv', 'pinv.id', 'payment_intents.invoice_id')
      .leftJoin('reservations as rsv', (join) =>
        join.on(sql<boolean>`rsv.id = coalesce(ph.reservation_id, pinv.reservation_id)`)
      )
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

    // Invariant 5: a payment whose hold, or the booking behind its hold or invoice, was
    // soft-deleted is gone from the books — in practice purged test data, whose bookings
    // were deleted and whose payment rows were left behind. Written against
    // payment_intents' own columns so the join-free count query applies it identically.
    const live = sql<boolean>`NOT EXISTS (
      SELECT 1 FROM holds dh
      LEFT JOIN reservations dr ON dr.id = dh.reservation_id
      WHERE dh.id = payment_intents.hold_id
        AND (dh.deleted_at IS NOT NULL OR dr.deleted_at IS NOT NULL)
    ) AND NOT EXISTS (
      SELECT 1 FROM invoices di
      JOIN reservations dr2 ON dr2.id = di.reservation_id
      WHERE di.id = payment_intents.invoice_id AND dr2.deleted_at IS NOT NULL
    )`;
    query = query.where(live);
    countQuery = countQuery.where(live);

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
      // Property via the intent's hold -> room (or the hold's reservation's room), or —
      // for a payment recorded against an invoice and no hold — the invoice's property.
      // Strict, unlike the invoice list: money received with no traceable property is not
      // shown in someone else's books.
      const inProperty = sql<boolean>`(
        exists (
          select 1 from holds h
          join rooms r on r.id = coalesce(
            h.room_id,
            (select res.room_id from reservations res where res.id = h.reservation_id)
          )
          join buildings b on b.id = r.building_id
          where h.id = payment_intents.hold_id and b.property_id = ${filters.property_id}
        )
        or (
          payment_intents.hold_id is null
          and (select ${invoicePropertyIdSql('pi_inv')} from invoices pi_inv where pi_inv.id = payment_intents.invoice_id) = ${filters.property_id}
        )
      )`;
      query = query.where(inProperty);
      countQuery = countQuery.where(inProperty);
    }

    const offset = (pagination.page - 1) * pagination.limit;
    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('payment_intents.created_at', 'desc').orderBy('payment_intents.id', 'desc').execute(),
      countQuery.execute(),
    ]);

    return { data, total: Number(total), page: pagination.page, limit: pagination.limit };
  }

  async create(intent: NewPaymentIntent, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    return inTransaction(this.db, async (trx) => {
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

  /**
   * SUCCESS: record the attempt, mark the intent PAID, confirm the hold and booking, raise
   * the receipt and re-size what is still owed — ONE transaction, under the booking's lock.
   *
   * Before this, settlePaid was a status flip and nothing more: no check the intent was
   * still payable (two parallel "success" clicks both succeeded), no cap on what was
   * collected, no invoice, and the folio total was only frozen by one caller (the desk
   * "Mark paid"), so the cockpit's Assign-booking deposit paid money that the folio, the
   * Invoices page and Finance never saw — and the next "Mark paid" collected it again.
   *
   * Lock order is reservation THEN intent, everywhere, so two settlers can't deadlock.
   */
  async settlePaid(params: AttemptParams, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    return inTransaction(this.db, async (trx) => {
      const reservation = params.reservationId
        ? await lockReservation(trx, params.reservationId)
        : undefined;
      if (params.reservationId && !reservation) {
        throw AppError.notFound(`Reservation ${params.reservationId} not found`);
      }
      // A cancelled or no-show booking owes nothing (reconcile voids its invoice), so money
      // landing on it afterwards — an online payment completing late — would be recorded
      // against a stay that is not happening. Only recordDeskPayment refused this before.
      if (reservation && (TERMINAL_RESERVATION_STATUSES as readonly string[]).includes(reservation.status)) {
        throw AppError.conflict(`A ${reservation.status.toLowerCase().replace('_', ' ')} booking can’t take payment.`);
      }

      const current = await trx
        .selectFrom('payment_intents')
        .selectAll()
        .where('id', '=', params.intentId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw AppError.notFound(`Payment intent ${params.intentId} not found`);
      if (current.status !== 'PENDING' && current.status !== 'RETRY') {
        // The loser of a double-click lands here, after the winner has committed.
        throw AppError.conflict(`Payment intent is ${current.status} and cannot be retried`);
      }

      const hold = await trx
        .selectFrom('holds')
        .select(['id', 'status'])
        .where('id', '=', params.holdId)
        .forUpdate()
        .executeTakeFirst();
      if (!hold || hold.status !== 'HELD') {
        throw AppError.conflict(`Hold is ${hold?.status ?? 'gone'}; payment cannot proceed`);
      }

      const quote = await trx
        .selectFrom('quotes')
        .select(['id', 'total_amount', 'tax_rate_bps', 'currency'])
        .where('id', '=', current.quote_id!)
        .executeTakeFirstOrThrow();

      const auditRows: NewAuditLog[] = [];
      const audit = (entity: string, entityId: string, diff: Record<string, unknown>): void => {
        auditRows.push({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity,
          entity_id: entityId,
          diff,
          ip_address: meta.ip ?? null,
        });
      };

      // ── Never collect more than is owed ────────────────────────────────────────────
      if (reservation) {
        const total = (await agreedTotal(trx, reservation)) ?? quote.total_amount;
        const paid = (await paidToDate(trx, [reservation.id])).get(reservation.id) ?? 0;
        const outstanding = Math.max(0, total - paid);
        if (outstanding <= 0) {
          throw AppError.conflict('This booking is already paid in full.');
        }
        if (current.amount > outstanding) {
          throw AppError.conflict(
            `That payment is more than this booking still owes. Outstanding: ${describeThebe(outstanding)}.`
          );
        }
        // The first money to touch a booking agrees its price (CLAUDE.md: the folio total
        // is frozen on first contact with money). Wizard bookings used to skip this and
        // so floated with the rate card.
        if (reservation.folio_total_amount == null) {
          await trx
            .updateTable('reservations')
            .set({ folio_total_amount: total, folio_currency: quote.currency, updated_by: meta.userId, updated_at: sql`now()` })
            .where('id', '=', reservation.id)
            .execute();
          audit('reservations', reservation.id, { folio_total_amount: total });
        }
      } else {
        // A bare hold (no booking yet): the quote is the agreement. Cap what has been
        // collected against it, lest a quote be paid three times over.
        const row = await trx
          .selectFrom('payment_intents')
          .select(sql<string>`COALESCE(SUM(amount), 0)`.as('paid'))
          .where('quote_id', '=', quote.id)
          .where('status', '=', 'PAID')
          .executeTakeFirst();
        const already = Number(row?.paid ?? 0);
        if (already + current.amount > quote.total_amount) {
          throw AppError.conflict(
            `That payment is more than this quote still owes. Outstanding: ${describeThebe(Math.max(0, quote.total_amount - already))}.`
          );
        }
      }

      await this.insertAttempt(trx, params, 'SUCCESS', meta);

      // The receipt: born PAID, in this transaction, and linked to the intent so the
      // Payments page and the Invoices page are two views of one record.
      const receipt = await insertReceipt(
        trx,
        {
          reservationId: reservation?.id ?? null,
          holdId: params.holdId,
          quoteId: quote.id,
          kind: current.purpose,
          amount: current.amount,
          taxRateBps: quote.tax_rate_bps,
          currency: quote.currency,
          checkInDay: reservation?.check_in_day,
        },
        meta
      );

      const intent = await trx
        .updateTable('payment_intents')
        .set({
          status: 'PAID',
          attempts: sql`attempts + 1`,
          paid_at: sql`now()`,
          last_error: null,
          invoice_id: receipt.id,
          updated_by: meta.userId,
          updated_at: sql`now()`,
        })
        .where('id', '=', params.intentId)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('holds')
        .set({ status: 'CONFIRMED', updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', params.holdId)
        .where('status', '=', 'HELD')
        .execute();

      audit('payment_intents', params.intentId, { status: 'PAID', invoice_id: receipt.id });
      audit('holds', params.holdId, { status: 'CONFIRMED' });

      // Close the money loop: a paid hold confirms its linked reservation.
      // Guarded so a re-run or a non-PENDING reservation is a safe no-op.
      if (reservation) {
        const confirmed = await trx
          .updateTable('reservations')
          .set({ status: 'CONFIRMED', updated_by: meta.userId, updated_at: sql`now()` })
          .where('id', '=', reservation.id)
          .where('status', '=', 'PENDING')
          .where('deleted_at', 'is', null)
          .returning('id')
          .executeTakeFirst();
        if (confirmed) audit('reservations', reservation.id, { status: 'CONFIRMED' });

        // What is still owed: keep exactly one open invoice, equal to the folio (invoices.receivable.ts).
        await reconcileReceivable(trx, reservation.id, meta, {
          taxRateBps: quote.tax_rate_bps,
          currency: quote.currency,
          quoteId: quote.id,
          holdId: params.holdId,
        });
      }

      await trx.insertInto('audit_logs').values(auditRows).execute();
      return intent;
    });
  }

  /**
   * A payment taken at the desk, start to finish, atomically.
   *
   * Mark-paid used to read the folio, compute "outstanding", and only THEN go off and
   * create a quote, a hold, an intent and an attempt as separate transactions — a
   * check-then-act race with no lock anywhere. Two parallel requests both saw P4,500
   * outstanding and both collected it. Here the booking row is locked FIRST, the
   * folio is re-read under the lock, and the quote, hold, intent, receipt and the
   * re-sized open invoice all commit together or not at all.
   *
   * All pricing (the slow reads) is done by the caller before this — see
   * PaymentsService.recordDeskPayment — so the transaction holds a connection only for
   * writes. A burst of parallel payments each waiting on the lock would otherwise pin
   * every pooled connection while the lock holder needs one more to finish: a deadlock
   * that looks like a hang.
   */
  async recordDeskPayment(p: DeskPaymentParams, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    return inTransaction(this.db, async (trx) => {
      const reservation = await lockReservation(trx, p.reservationId);
      if (!reservation) throw AppError.notFound(`Reservation ${p.reservationId} not found`);

      // The status may have changed while we queued for the lock (cancelled, checked-out).
      if ((TERMINAL_RESERVATION_STATUSES as readonly string[]).includes(reservation.status)) {
        throw AppError.conflict(`A ${reservation.status.toLowerCase().replace('_', ' ')} booking can’t take payment.`);
      }
      if (reservation.status === 'BLOCKED') {
        throw AppError.conflict('This is a channel block, not a guest booking; there is nothing to pay.');
      }

      // Same figure the folio shows: the frozen total, else today's price.
      const total = reservation.folio_total_amount ?? p.pricedTotal;
      const paid = (await paidToDate(trx, [p.reservationId])).get(p.reservationId) ?? 0;
      const outstanding = Math.max(0, total - paid);

      const amount = p.amount ?? outstanding;
      if (amount <= 0) {
        throw AppError.badRequest(
          outstanding <= 0 ? 'This booking is already paid in full.' : 'Enter how much the guest paid.'
        );
      }
      if (amount > outstanding) {
        throw AppError.badRequest(
          `That is more than this booking still owes. Outstanding: ${describeThebe(outstanding)}.`
        );
      }

      // The wizard's hold for this booking (if it is still live) is superseded by this
      // payment — see releaseReservationHolds. Done before the new hold is opened, so the
      // unit never has two live holds.
      await releaseReservationHolds(trx, p.reservationId, 'superseded_by_desk_payment', meta);

      const quote = await new QuotesRepository(trx).create(p.quote, meta);
      const hold = await new HoldsRepository(trx).create(
        {
          quoteId: quote.id,
          roomId: p.roomId,
          reservationId: p.reservationId,
          heldUntil: new Date(Date.now() + p.holdTtlMs),
        },
        meta
      );
      const repo = new PaymentsRepository(trx);
      const intent = await repo.create(
        {
          hold_id: hold.id,
          quote_id: quote.id,
          purpose: amount >= outstanding ? 'BALANCE' : 'DEPOSIT',
          amount,
          currency: quote.currency,
          method: p.method,
          max_attempts: 3,
          created_by: meta.userId,
          updated_by: meta.userId,
        },
        meta
      );

      // The folio total is frozen by settlePaid (agreedTotal falls back to the quote, so
      // pass the figure the folio showed by freezing it here first when unfrozen).
      if (reservation.folio_total_amount == null) {
        await trx
          .updateTable('reservations')
          .set({ folio_total_amount: total, folio_currency: quote.currency, updated_by: meta.userId, updated_at: sql`now()` })
          .where('id', '=', p.reservationId)
          .execute();
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'reservations',
          entity_id: p.reservationId,
          diff: { folio_total_amount: total, reason: 'price agreed on first payment' },
          ip_address: meta.ip ?? null,
        }).execute();
      }

      return repo.settlePaid(
        {
          intentId: intent.id,
          holdId: hold.id,
          reservationId: p.reservationId,
          attemptNo: 1,
          method: p.method,
          reference: p.reference,
          note: p.note,
        },
        meta
      );
    });
  }

  // FAILURE with attempts remaining: RETRY, keep the hold, extend its window.
  async recordRetry(params: AttemptParams, meta: PaymentRequestMeta): Promise<PaymentIntentRow> {
    return inTransaction(this.db, async (trx) => {
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
    return inTransaction(this.db, async (trx) => {
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
