import { Kysely, sql } from 'kysely';
import type { Database, InvoiceRow, NewInvoice } from '../../db/types.js';
import { AppError } from '../../core/errors/AppError.js';
import { companyDetails, type CompanyDetails } from '../../core/settings/appSettings.js';
import { inTransaction } from '../../core/db/transaction.js';
import { propertyToday } from '../../core/time.js';
import { invoiceVisibleInProperty } from '../../core/scope/invoiceProperty.js';
import {
  agreedTotal,
  describeThebe,
  lockReservation,
  paidToDate,
  OPEN_INVOICE_STATUSES,
} from '../../core/money/folio.js';
import type { PaginationOptions } from '../crm/crm.types.js';
import { insertInvoice, reconcileReceivable } from './invoices.receivable.js';
import type {
  InvoiceFilters,
  InvoiceStatus,
  InvoiceRequestMeta,
  InvoiceListResult,
  InvoiceListTotals,
} from './invoices.types.js';

/** An invoice as the service knows it: everything but the number, which only the
 *  repository may allocate (D09 — see create()). */
export type UnnumberedInvoice = Omit<NewInvoice, 'number'>;

export class InvoicesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async findById(id: string): Promise<InvoiceRow | undefined> {
    return this.db
      .selectFrom('invoices')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  // Everything a printable invoice/receipt needs: the invoice + the guest + the
  // stay + the bill-to (A4: the reservation's billing/accounts contact when one
  // is assigned, otherwise the guest themselves).
  /** (P7) The business details from Settings, for the printed and emailed document. */
  companyDetails(): Promise<CompanyDetails> {
    return companyDetails(this.db);
  }

  async findDocumentData(id: string) {
    return this.db
      .selectFrom('invoices as i')
      .leftJoin('reservations as rsv', 'rsv.id', 'i.reservation_id')
      .leftJoin('contacts as c', 'c.id', 'rsv.contact_id')
      .leftJoin('contacts as bc', 'bc.id', 'rsv.billing_contact_id')
      .leftJoin('rooms as rm', 'rm.id', 'rsv.room_id')
      .leftJoin('quotes as q', 'q.id', 'i.quote_id')
      .select([
        'i.id', 'i.number', 'i.kind', 'i.status', 'i.currency',
        'i.subtotal_amount', 'i.tax_rate_bps', 'i.tax_amount', 'i.total_amount', 'i.created_at',
        sql<string | null>`to_char(i.due_date, 'YYYY-MM-DD')`.as('due_date'),
        'c.name as guest_name', 'c.email as guest_email', 'c.phone as guest_phone',
        sql<string | null>`coalesce(bc.name, c.name)`.as('bill_to_name'),
        sql<string | null>`coalesce(bc.email, c.email)`.as('bill_to_email'),
        sql<string | null>`to_char(rsv.check_in_date, 'YYYY-MM-DD')`.as('check_in_date'),
        sql<string | null>`to_char(rsv.check_out_date, 'YYYY-MM-DD')`.as('check_out_date'),
        'rm.code as unit_code', 'rm.name as unit_name', 'q.nights', 'q.unit_type',
        sql<number>`(SELECT COALESCE(SUM(cn.total_amount), 0)::int FROM invoices cn
                     WHERE cn.refund_of_invoice_id = i.id AND cn.deleted_at IS NULL)`.as('refunded_amount'),
      ])
      .where('i.id', '=', id)
      .where('i.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * The reservation behind a quote, via the hold the quote produced.
   *
   * An invoice raised from the Invoices screen carries only a quote_id, and a quote
   * has no guest on it — so without this the invoice is permanently anonymous. The
   * hold is the join that knows: quote -> hold -> reservation -> contact.
   */
  async findReservationIdForQuote(quoteId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('holds')
      .select('reservation_id')
      .where('quote_id', '=', quoteId)
      .where('reservation_id', 'is not', null)
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return row?.reservation_id ?? null;
  }

  /** A booking and the property its unit sits in, or undefined if it does not exist. */
  async findReservationProperty(
    reservationId: string
  ): Promise<{ id: string; property_id: string | null } | undefined> {
    const row = await this.db
      .selectFrom('reservations as r')
      .leftJoin('rooms as rm', 'rm.id', 'r.room_id')
      .leftJoin('buildings as b', 'b.id', 'rm.building_id')
      .select(['r.id', 'b.property_id'])
      .where('r.id', '=', reservationId)
      .where('r.deleted_at', 'is', null)
      .executeTakeFirst();
    return row ?? undefined;
  }

  // Audit trail for an invoice emailed to the guest.
  async recordEmailSent(id: string, email: string, meta: InvoiceRequestMeta): Promise<void> {
    await this.db.insertInto('audit_logs').values({
      request_id: meta.requestId ?? null,
      user_id: meta.userId,
      action: 'UPDATE',
      entity: 'invoices',
      entity_id: id,
      diff: { emailed_to: email },
      ip_address: meta.ip ?? null,
    }).execute();
  }

  async findPaginated(
    filters: InvoiceFilters,
    pagination: PaginationOptions
  ): Promise<InvoiceListResult> {
    // Who + which stay, resolved the same way the printable document resolves them:
    // the invoice's own reservation when it has one, else the reservation behind its
    // hold. Bill-to coalesces to the billing/accounts contact (A4) before the guest,
    // so the name shown is the name that owes the money.
    //
    // Every join is LEFT and lands on a primary key, so none of them can multiply a
    // row — the count and totals below reuse the same base query unchanged.
    // Alias `ih` (not `h`): the property filter opens its own `holds h` subquery, and
    // an outer `h` shadowed by an inner one is legal SQL that reads like a bug.
    let base = this.db
      .selectFrom('invoices')
      .leftJoin('holds as ih', 'ih.id', 'invoices.hold_id')
      .leftJoin('reservations as rsv', (join) =>
        join.on(sql<boolean>`rsv.id = coalesce(invoices.reservation_id, ih.reservation_id)`)
      )
      .leftJoin('contacts as c', 'c.id', 'rsv.contact_id')
      .leftJoin('contacts as bc', 'bc.id', 'rsv.billing_contact_id')
      .leftJoin('rooms as rm', 'rm.id', 'rsv.room_id')
      .where('invoices.deleted_at', 'is', null);

    // Every filter the API accepts is applied here — a filter that is accepted and then
    // ignored is worse than one that does not exist, because the screen reads as
    // filtered and is not (stage-1 finding: outstanding/search/dates/property all fell
    // on the floor and the Invoices page counted rows it was not showing).
    // Qualified throughout: `status`, `quote_id` and `hold_id` exist on several joined tables.
    if (filters.kind) base = base.where('invoices.kind', '=', filters.kind);
    if (filters.quote_id) base = base.where('invoices.quote_id', '=', filters.quote_id);
    if (filters.hold_id) base = base.where('invoices.hold_id', '=', filters.hold_id);
    if (filters.property_id) {
      // One shared resolution with the Finance cockpit — see invoiceProperty.ts.
      base = base.where(invoiceVisibleInProperty(filters.property_id));
    }
    if (filters.search) {
      const pat = `%${filters.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      base = base.where((eb) =>
        eb.or([
          eb('invoices.number', 'ilike', pat),
          eb('c.name', 'ilike', pat),
          eb('bc.name', 'ilike', pat),
          eb('rm.code', 'ilike', pat),
          eb('rm.name', 'ilike', pat),
        ])
      );
    }
    // Dates are Africa/Gaborone calendar days (invariant 2), not UTC days.
    if (filters.from) {
      base = base.where(sql<boolean>`(invoices.created_at AT TIME ZONE 'Africa/Gaborone')::date >= ${filters.from}::date`);
    }
    if (filters.to) {
      base = base.where(sql<boolean>`(invoices.created_at AT TIME ZONE 'Africa/Gaborone')::date <= ${filters.to}::date`);
    }

    // The status-shaped filters apply to the rows AND the count, but not to `totals`,
    // which always answers "what is owed / overdue in this view" regardless of which
    // status tab is open.
    let listed = base;
    if (filters.status) listed = listed.where('invoices.status', '=', filters.status);
    if (filters.outstanding) {
      listed = listed.where('invoices.status', 'in', [...OPEN_INVOICE_STATUSES]).where('invoices.kind', '<>', 'REFUND');
    }
    if (filters.overdue) {
      listed = listed
        .where('invoices.status', 'in', [...OPEN_INVOICE_STATUSES])
        .where('invoices.kind', '<>', 'REFUND')
        .where(sql<boolean>`invoices.due_date < ${propertyToday()}`);
    }
    if (filters.incoming) {
      // Owed, but not late: due today or later (or a legacy row with no due date yet).
      listed = listed
        .where('invoices.status', 'in', [...OPEN_INVOICE_STATUSES])
        .where('invoices.kind', '<>', 'REFUND')
        .where(sql<boolean>`(invoices.due_date IS NULL OR invoices.due_date >= ${propertyToday()})`);
    }

    const offset = (pagination.page - 1) * pagination.limit;
    const [data, [{ total }], [totals]] = await Promise.all([
      listed
        .selectAll('invoices')
        .select([
          sql<string | null>`to_char(invoices.due_date, 'YYYY-MM-DD')`.as('due_date'),
          sql<boolean>`(invoices.status IN ('ISSUED','PARTIALLY_PAID') AND invoices.kind <> 'REFUND'
                        AND invoices.due_date < ${propertyToday()})`.as('is_overdue'),
          sql<string | null>`coalesce(bc.name, c.name)`.as('bill_to_name'),
          sql<string | null>`c.name`.as('guest_name'),
          sql<string | null>`rm.code`.as('unit_code'),
          // (075) Given back so far on this invoice — "Paid · P100 refunded".
          sql<number>`(SELECT COALESCE(SUM(cn.total_amount), 0)::int FROM invoices cn
                       WHERE cn.refund_of_invoice_id = invoices.id AND cn.deleted_at IS NULL)`.as('refunded_amount'),
          sql<string | null>`to_char(rsv.check_in_date, 'YYYY-MM-DD')`.as('check_in_date'),
          sql<string | null>`to_char(rsv.check_out_date, 'YYYY-MM-DD')`.as('check_out_date'),
        ])
        .orderBy('invoices.created_at', 'desc')
        .orderBy('invoices.id', 'desc')
        .limit(pagination.limit)
        .offset(offset)
        .execute(),
      listed.select(this.db.fn.countAll<number>().as('total')).execute(),
      base
        .select([
          sql<string>`COALESCE(SUM(invoices.total_amount) FILTER (WHERE invoices.status IN ('ISSUED','PARTIALLY_PAID') AND invoices.kind <> 'REFUND'), 0)`.as('outstanding_amount'),
          sql<string>`COUNT(*) FILTER (WHERE invoices.status IN ('ISSUED','PARTIALLY_PAID') AND invoices.kind <> 'REFUND')`.as('outstanding_count'),
          sql<string>`COALESCE(SUM(invoices.total_amount) FILTER (WHERE invoices.status IN ('ISSUED','PARTIALLY_PAID') AND invoices.kind <> 'REFUND' AND invoices.due_date < ${propertyToday()}), 0)`.as('overdue_amount'),
          sql<string>`COUNT(*) FILTER (WHERE invoices.status IN ('ISSUED','PARTIALLY_PAID') AND invoices.kind <> 'REFUND' AND invoices.due_date < ${propertyToday()})`.as('overdue_count'),
        ])
        .execute(),
    ]);

    const t: InvoiceListTotals = {
      outstanding_amount: Number(totals!.outstanding_amount),
      outstanding_count: Number(totals!.outstanding_count),
      overdue_amount: Number(totals!.overdue_amount),
      overdue_count: Number(totals!.overdue_count),
      scope:
        'Money still owed across every invoice matching your search, branch and date filters. It ignores the status tab, so the Paid tab still shows what is owed elsewhere.',
    };

    return {
      data: data as unknown as InvoiceListResult['data'],
      total: Number(total),
      page: pagination.page,
      limit: pagination.limit,
      totals: t,
    };
  }

  /**
   * Raise an OPEN invoice (ISSUED / PARTIALLY_PAID) — the manual "New invoice" path.
   *
   * The number is allocated inside insertInvoice(), in the same transaction as the
   * insert, which is what makes the series gapless (D09): a failed insert rolls the
   * counter back with it.
   *
   * When the invoice belongs to a booking it takes that booking's lock first, and
   * refuses to bill more than the booking still owes MINUS what is already invoiced and
   * unpaid. Without it, "New invoice" on a booking with an open balance double-counted
   * the debt: Finance's open receivables then no longer equalled the folio.
   */
  async create(invoice: UnnumberedInvoice, meta: InvoiceRequestMeta): Promise<InvoiceRow> {
    return inTransaction(this.db, async (trx) => {
      let checkInDay: string | null = null;
      let status = invoice.status;

      if (invoice.reservation_id) {
        const reservation = await lockReservation(trx, invoice.reservation_id);
        if (!reservation) throw AppError.notFound('That booking could not be found.');
        checkInDay = reservation.check_in_day;

        if (invoice.kind !== 'REFUND' && (invoice.status ?? 'ISSUED') !== 'PAID') {
          const total = await agreedTotal(trx, reservation);
          const paid = (await paidToDate(trx, [reservation.id])).get(reservation.id) ?? 0;
          if (total != null) {
            const outstanding = Math.max(0, total - paid);
            const invoiced = await openInvoicedTotal(trx, reservation.id);
            if (invoiced + invoice.total_amount > outstanding) {
              throw AppError.conflict(
                outstanding === 0
                  ? 'This booking is already paid in full, so there is nothing left to invoice.'
                  : `This booking only owes ${describeThebe(outstanding)}` +
                      (invoiced > 0 ? ` and ${describeThebe(invoiced)} of that is already invoiced and unpaid` : '') +
                      `, so a new invoice for ${describeThebe(invoice.total_amount)} would bill it twice. ` +
                      'Settle or amend the open invoice instead.'
              );
            }
          }
          // PARTIALLY_PAID has one meaning: an open invoice on a booking that has
          // already had money received against it (see invoices.receivable.ts).
          status = paid > 0 ? 'PARTIALLY_PAID' : 'ISSUED';
        }
      }

      return insertInvoice(trx, { ...invoice, status }, meta, { checkInDay });
    });
  }

  /**
   * Mark an open invoice paid, ATOMICALLY with everything that follows from it.
   *
   * Inside one transaction: lock the booking, lock the invoice, refuse to collect more
   * than the booking still owes, flip the status (guarded on the row still being open, so
   * a double click or a race can only ever win once), record the payment itself so the
   * Payments page agrees with the Invoices page, and re-size whatever is still owed.
   *
   * "Never collect more than owed": an open invoice larger than the folio's outstanding
   * is STALE (left behind by the old per-payment invoicing) and settling it would collect
   * the money a second time — so it is refused with the numbers in the message, and the
   * invoice backfill is what retires it.
   */
  async settle(
    id: string,
    opts: { receiptFileId: string | null; method: PaymentMethodValue; note?: string | null },
    meta: InvoiceRequestMeta
  ): Promise<InvoiceRow | undefined> {
    return inTransaction(this.db, async (trx) => {
      const peek = await trx
        .selectFrom('invoices')
        .select(['id', 'reservation_id'])
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!peek) return undefined;

      // Booking lock first, invoice lock second — the same order every other money
      // writer uses (settlePaid, refund), so two of them cannot deadlock each other.
      if (peek.reservation_id) await lockReservation(trx, peek.reservation_id);

      const invoice = await trx
        .selectFrom('invoices')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!invoice) return undefined;

      if (invoice.status === 'PAID') throw AppError.conflict('Invoice is already paid');
      if (invoice.status === 'REFUNDED' || invoice.status === 'VOID') {
        throw AppError.conflict(`Cannot settle a ${invoice.status} invoice`);
      }
      if (invoice.kind === 'REFUND') throw AppError.conflict('A refund invoice cannot be settled.');

      if (invoice.reservation_id) {
        const reservation = (await lockReservation(trx, invoice.reservation_id))!;
        const total = await agreedTotal(trx, reservation);
        const paid = (await paidToDate(trx, [reservation.id])).get(reservation.id) ?? 0;
        if (total != null) {
          const outstanding = Math.max(0, total - paid);
          if (invoice.total_amount > outstanding) {
            throw AppError.conflict(
              outstanding === 0
                ? 'This booking is already paid in full, so there is nothing left to collect on this invoice. ' +
                    'It is a leftover from an earlier part payment — ask an admin to correct this booking’s invoices.'
                : `This invoice is for ${describeThebe(invoice.total_amount)} but the booking only owes ` +
                    `${describeThebe(outstanding)}, so settling it would collect too much. ` +
                    'It is a leftover from an earlier part payment — ask an admin to correct this booking’s invoices.'
            );
          }
        }
      }

      const updated = await trx
        .updateTable('invoices')
        .set({
          status: 'PAID',
          ...(opts.receiptFileId !== null ? { receipt_file_id: opts.receiptFileId } : {}),
          updated_by: meta.userId,
          updated_at: sql`now()`,
        })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .where('status', 'in', [...OPEN_INVOICE_STATUSES])
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw AppError.conflict('Invoice is already paid');

      // The payment itself. Without a row here the Payments page — which lists payment
      // intents — never heard about money collected from the Invoices screen.
      const intent = await trx
        .insertInto('payment_intents')
        .values({
          hold_id: invoice.hold_id,
          quote_id: invoice.quote_id,
          invoice_id: invoice.id,
          purpose: invoice.kind === 'DEPOSIT' ? 'DEPOSIT' : 'BALANCE',
          amount: invoice.total_amount,
          currency: invoice.currency,
          method: opts.method,
          status: 'PAID',
          attempts: 1,
          paid_at: sql`now()`,
          created_by: meta.userId,
          updated_by: meta.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('payment_attempts').values({
        payment_intent_id: intent.id,
        attempt_no: 1,
        outcome: 'SUCCESS',
        method: opts.method,
        reference: null,
        note: opts.note ?? 'Marked paid from the invoice',
        created_by: meta.userId,
      }).execute();

      await trx.insertInto('audit_logs').values([
        {
          request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE',
          entity: 'invoices', entity_id: id,
          diff: { status: 'PAID', receipt_file_id: opts.receiptFileId },
          ip_address: meta.ip ?? null,
        },
        {
          request_id: meta.requestId ?? null, user_id: meta.userId, action: 'CREATE',
          entity: 'payment_intents', entity_id: intent.id,
          diff: { status: 'PAID', invoice_id: id, amount: invoice.total_amount, method: opts.method },
          ip_address: meta.ip ?? null,
        },
      ]).execute();

      // What is still owed after this payment (nothing, or a smaller balance).
      if (invoice.reservation_id) {
        await reconcileReceivable(trx, invoice.reservation_id, meta);
      }
      return updated;
    });
  }

  async markStatus(id: string, status: InvoiceStatus, meta: InvoiceRequestMeta): Promise<InvoiceRow | undefined> {
    return inTransaction(this.db, async (trx) => {
      const updated = await trx
        .updateTable('invoices')
        .set({ status, updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (updated) {
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'invoices',
          entity_id: id,
          diff: { status },
          ip_address: meta.ip ?? null,
        }).execute();
      }
      return updated;
    });
  }

  // Refund: issue a REFUND credit note against a PAID invoice, atomically.
  //
  // Owner decision 2026-10-02: a refund does NOT put the guest back in debt. Money handed
  // back is money the house has chosen to give up (goodwill, a discount, a shortened
  // stay), so the agreed total comes down by the same amount as what was received:
  // outstanding is unchanged by a refund. An earlier draft left the total alone, which
  // re-raised the refunded sum as a new open invoice for Accounts to chase.
  //
  // Owner decision 2026-10-04 (partial refunds): the original stays PAID until EVERY
  // thebe of it has gone back, and may be refunded again up to what is left. Each credit
  // note points at its original (refund_of_invoice_id, migration 075), so "what is left"
  // is total − Σ linked credit notes, read under the original's row lock. Before this, any
  // refund flipped the whole invoice to REFUNDED, and a P100 refund on P1,666 read as
  // "refunded in full".
  //
  // The receivable is then reconciled in the same transaction so folio and invoices agree.
  async refund(
    originalId: string,
    refundInvoice: UnnumberedInvoice,
    reason: string,
    meta: InvoiceRequestMeta,
    opts: { duplicateGuard?: boolean } = {}
  ): Promise<InvoiceRow> {
    return inTransaction(this.db, async (trx) => {
      if (refundInvoice.reservation_id) await lockReservation(trx, refundInvoice.reservation_id);

      // The service checks "is it PAID?" before this transaction opens, so two parallel
      // refund clicks both passed it. Re-check under the invoice's own row lock (taken
      // after the booking's — the same order settle uses); the loser waits here and then
      // sees what the winner already gave back. Invoices with no booking are covered too:
      // they never took the reservation lock above.
      const original = await trx
        .selectFrom('invoices')
        .select(['status', 'kind', 'total_amount', 'currency'])
        .where('id', '=', originalId)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!original) throw AppError.notFound(`Invoice ${originalId} not found`);
      if (original.kind === 'REFUND') {
        throw AppError.conflict('A refund can’t itself be refunded.');
      }
      if (original.status !== 'PAID') {
        throw AppError.conflict(
          original.status === 'REFUNDED'
            ? 'This invoice has already been refunded in full.'
            : `Only a paid invoice can be refunded (this one is ${original.status}).`
        );
      }
      const already = await refundedSoFar(trx, originalId);
      const left = original.total_amount - already;
      if (refundInvoice.total_amount > left) {
        // After an earlier refund this is a matter of state, not a malformed request —
        // typically the other half of a double click — so it is a 409 that says what has
        // already gone back. Asking for more than the whole invoice stays a 400.
        const msg = `Only ${formatThebe(left, original.currency)} of this invoice is left to refund.`;
        if (already > 0) {
          throw AppError.conflict(`${msg} ${formatThebe(already, original.currency)} has already been refunded on it.`);
        }
        throw AppError.badRequest(msg);
      }

      // Double-submit guard for callers that sent no Idempotency-Key: the same amount on
      // the same invoice by the same person within seconds is a repeat click far more often
      // than a deliberate second refund. (Two refunds that both fit are otherwise legitimate,
      // so this is a short window, not a rule.) Decided under the invoice lock, so of N
      // parallel identical requests exactly one gets through.
      if (opts.duplicateGuard !== false) {
        const recent = await trx
          .selectFrom('invoices')
          .select('id')
          .where('refund_of_invoice_id', '=', originalId)
          .where('kind', '=', 'REFUND')
          .where('deleted_at', 'is', null)
          .where('total_amount', '=', refundInvoice.total_amount)
          .where('created_by', '=', meta.userId)
          .where('created_at', '>', sql<Date>`now() - make_interval(secs => ${DUPLICATE_REFUND_WINDOW_SECONDS})`)
          .limit(1)
          .executeTakeFirst();
        if (recent) {
          throw AppError.conflict('This looks like a duplicate refund — wait or use a different amount.');
        }
      }

      // A booking whose paid total is above its agreed total (a stay shortened after
      // payment) owes the guest that credit back. Refunding more than the credit is no
      // longer "settling what the house owes" — it would eat into money for nights that
      // were actually stayed — so it is refused here, to the thebe, under the booking lock.
      if (refundInvoice.reservation_id) {
        const reservation = (await lockReservation(trx, refundInvoice.reservation_id))!;
        const agreed = await agreedTotal(trx, reservation);
        if (agreed != null) {
          const paidNow = (await paidToDate(trx, [reservation.id])).get(reservation.id) ?? 0;
          const credit = Math.max(0, paidNow - agreed);
          if (credit > 0 && refundInvoice.total_amount > credit) {
            throw AppError.conflict(
              `This booking was shortened after payment, so only ${formatThebe(credit, original.currency)} is owed back to the guest. ` +
                `That is the most that can be refunded until the stay changes.`
            );
          }
        }
      }

      // A credit note takes the next number in the same series as the invoice it
      // reverses — a hole where a refund sits reads exactly like a removed document.
      const refund = await insertInvoice(trx, { ...refundInvoice, refund_of_invoice_id: originalId }, meta);

      const full = already + refundInvoice.total_amount >= original.total_amount;
      if (full) {
        await trx
          .updateTable('invoices')
          .set({ status: 'REFUNDED', updated_by: meta.userId, updated_at: sql`now()` })
          .where('id', '=', originalId)
          .execute();
      }

      await trx.insertInto('audit_logs').values([
        {
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'invoices',
          entity_id: originalId,
          diff: {
            ...(full ? { status: 'REFUNDED' } : {}),
            refunded_amount: { from: already, to: already + refundInvoice.total_amount },
            credit_note_id: refund.id,
            reason,
          },
          ip_address: meta.ip ?? null,
        },
      ]).execute();

      if (refundInvoice.reservation_id) {
        const reservation = (await lockReservation(trx, refundInvoice.reservation_id))!;
        // Read BEFORE lowering: agreedTotal falls back to the invoices when nothing is
        // frozen, and those still include the original at full value.
        const total = await agreedTotal(trx, reservation);
        if (total != null) {
          // (Re-test 2026-10-04) Money paid BEYOND the agreed total — a stay shortened
          // after payment — is already the guest's (the folio shows it as a refund due).
          // Handing that back is settling what the house owes, not a concession, so only
          // the part of a refund that goes past the credit lowers the agreed total.
          // paidToDate already includes this refund's credit note; add it back for "before".
          const paidAfter = (await paidToDate(trx, [reservation.id])).get(reservation.id) ?? 0;
          const creditBefore = Math.max(0, paidAfter + refundInvoice.total_amount - total);
          const lowerBy = Math.max(0, refundInvoice.total_amount - creditBefore);
          const lowered = Math.max(0, total - lowerBy);
          if (lowered !== total) {
            await trx
              .updateTable('reservations')
              .set({ folio_total_amount: lowered, updated_by: meta.userId, updated_at: sql`now()` })
              .where('id', '=', reservation.id)
              .execute();
            await trx.insertInto('audit_logs').values({
              request_id: meta.requestId ?? null,
              user_id: meta.userId,
              action: 'UPDATE',
              entity: 'reservations',
              entity_id: reservation.id,
              diff: { folio_total_amount: { from: total, to: lowered }, reason: 'refund lowers the agreed total' },
              ip_address: meta.ip ?? null,
            }).execute();
          }
        }
        await reconcileReceivable(trx, refundInvoice.reservation_id, meta);
      }

      return refund;
    });
  }
}

/** Thebe already handed back on an invoice: the sum of the credit notes that point at it. */
/** A repeat of the same refund inside this many seconds, with no Idempotency-Key, is refused. */
const DUPLICATE_REFUND_WINDOW_SECONDS = 10;

export async function refundedSoFar(trx: Kysely<Database>, invoiceId: string): Promise<number> {
  const row = await trx
    .selectFrom('invoices')
    .select(sql<string>`COALESCE(SUM(total_amount), 0)`.as('total'))
    .where('refund_of_invoice_id', '=', invoiceId)
    .where('kind', '=', 'REFUND')
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

/** "BWP 1,566.00" — the user-facing amount in an error message. */
function formatThebe(thebe: number, currency: string): string {
  return `${currency} ${(thebe / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type PaymentMethodValue = 'CARD' | 'MOBILE_MONEY' | 'EFT' | 'CASH' | 'CORPORATE_CREDIT' | 'OTHER';

/** Sum of a booking's open (ISSUED / PARTIALLY_PAID) non-refund invoices. */
async function openInvoicedTotal(trx: Kysely<Database>, reservationId: string): Promise<number> {
  const row = await trx
    .selectFrom('invoices')
    .select(sql<string>`COALESCE(SUM(total_amount), 0)`.as('total'))
    .where('reservation_id', '=', reservationId)
    .where('deleted_at', 'is', null)
    .where('kind', '<>', 'REFUND')
    .where('status', 'in', [...OPEN_INVOICE_STATUSES])
    .executeTakeFirstOrThrow();
  return Number(row.total);
}
