import { Kysely, sql } from 'kysely';
import type { Database, InvoiceRow, NewInvoice } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { InvoiceFilters, InvoiceStatus, InvoiceRequestMeta, InvoiceListRow } from './invoices.types.js';

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
        'c.name as guest_name', 'c.email as guest_email', 'c.phone as guest_phone',
        sql<string | null>`coalesce(bc.name, c.name)`.as('bill_to_name'),
        sql<string | null>`coalesce(bc.email, c.email)`.as('bill_to_email'),
        sql<string | null>`to_char(rsv.check_in_date, 'YYYY-MM-DD')`.as('check_in_date'),
        sql<string | null>`to_char(rsv.check_out_date, 'YYYY-MM-DD')`.as('check_out_date'),
        'rm.code as unit_code', 'rm.name as unit_name', 'q.nights', 'q.unit_type',
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
  ): Promise<PaginatedResult<InvoiceRow & InvoiceListRow>> {
    // Who + which stay, resolved the same way the printable document resolves them:
    // the invoice's own reservation when it has one, else the reservation behind its
    // hold. Bill-to coalesces to the billing/accounts contact (A4) before the guest,
    // so the name shown is the name that owes the money.
    //
    // Every join is LEFT and lands on a primary key, so none of them can multiply a
    // row — the count query below stays correct without repeating them.
    // Alias `ih` (not `h`): the property filter opens its own `holds h` subquery, and
    // an outer `h` shadowed by an inner one is legal SQL that reads like a bug.
    let query = this.db
      .selectFrom('invoices')
      .leftJoin('holds as ih', 'ih.id', 'invoices.hold_id')
      .leftJoin('reservations as rsv', (join) =>
        join.on(sql<boolean>`rsv.id = coalesce(invoices.reservation_id, ih.reservation_id)`)
      )
      .leftJoin('contacts as c', 'c.id', 'rsv.contact_id')
      .leftJoin('contacts as bc', 'bc.id', 'rsv.billing_contact_id')
      .leftJoin('rooms as rm', 'rm.id', 'rsv.room_id')
      .selectAll('invoices')
      .select([
        sql<string | null>`coalesce(bc.name, c.name)`.as('bill_to_name'),
        sql<string | null>`c.name`.as('guest_name'),
        sql<string | null>`rm.code`.as('unit_code'),
        sql<string | null>`to_char(rsv.check_in_date, 'YYYY-MM-DD')`.as('check_in_date'),
        sql<string | null>`to_char(rsv.check_out_date, 'YYYY-MM-DD')`.as('check_out_date'),
      ])
      .where('invoices.deleted_at', 'is', null);

    let countQuery = this.db
      .selectFrom('invoices')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null);

    // Filters are qualified on the joined query: `status` and `quote_id` now exist on
    // more than one table in scope, so an unqualified name is ambiguous to Postgres.
    if (filters.status) {
      query = query.where('invoices.status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
    }
    if (filters.kind) {
      query = query.where('invoices.kind', '=', filters.kind);
      countQuery = countQuery.where('kind', '=', filters.kind);
    }
    if (filters.quote_id) {
      query = query.where('invoices.quote_id', '=', filters.quote_id);
      countQuery = countQuery.where('quote_id', '=', filters.quote_id);
    }
    if (filters.hold_id) {
      query = query.where('invoices.hold_id', '=', filters.hold_id);
      countQuery = countQuery.where('hold_id', '=', filters.hold_id);
    }

    if (filters.property_id) {
      // Property via the invoice's reservation, else its hold's room/reservation.
      const inProperty = sql<boolean>`exists (
        select 1 from rooms r
        join buildings b on b.id = r.building_id
        where r.id = coalesce(
          (select res.room_id from reservations res where res.id = invoices.reservation_id),
          (select h.room_id from holds h where h.id = invoices.hold_id),
          (select res2.room_id from holds h2
             join reservations res2 on res2.id = h2.reservation_id
           where h2.id = invoices.hold_id)
        )
        and b.property_id = ${filters.property_id}
      )`;
      query = query.where(inProperty);
      countQuery = countQuery.where(inProperty);
    }

    const offset = (pagination.page - 1) * pagination.limit;
    const [data, [{ total }]] = await Promise.all([
      query.limit(pagination.limit).offset(offset).orderBy('invoices.created_at', 'desc').execute(),
      countQuery.execute(),
    ]);

    return { data, total: Number(total), page: pagination.page, limit: pagination.limit };
  }

  async create(invoice: NewInvoice, meta: InvoiceRequestMeta): Promise<InvoiceRow> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('invoices')
        .values(invoice)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'CREATE',
        entity: 'invoices',
        entity_id: inserted.id,
        diff: inserted,
        ip_address: meta.ip ?? null,
      }).execute();

      return inserted;
    });
  }

  async settle(
    id: string,
    receiptFileId: string | null,
    meta: InvoiceRequestMeta
  ): Promise<InvoiceRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('invoices')
        .set({
          status: 'PAID',
          ...(receiptFileId !== null ? { receipt_file_id: receiptFileId } : {}),
          updated_by: meta.userId,
          updated_at: sql`now()`,
        })
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
          diff: { status: 'PAID', receipt_file_id: receiptFileId },
          ip_address: meta.ip ?? null,
        }).execute();
      }
      return updated;
    });
  }

  async markStatus(id: string, status: InvoiceStatus, meta: InvoiceRequestMeta): Promise<InvoiceRow | undefined> {
    return this.db.transaction().execute(async (trx) => {
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

  // Refund: issue a REFUND invoice and flip the original to REFUNDED atomically.
  async refund(
    originalId: string,
    refundInvoice: NewInvoice,
    reason: string,
    meta: InvoiceRequestMeta
  ): Promise<InvoiceRow> {
    return this.db.transaction().execute(async (trx) => {
      const refund = await trx
        .insertInto('invoices')
        .values(refundInvoice)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('invoices')
        .set({ status: 'REFUNDED', updated_by: meta.userId, updated_at: sql`now()` })
        .where('id', '=', originalId)
        .execute();

      await trx.insertInto('audit_logs').values([
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'CREATE', entity: 'invoices', entity_id: refund.id, diff: { ...refund, reason }, ip_address: meta.ip ?? null },
        { request_id: meta.requestId ?? null, user_id: meta.userId, action: 'UPDATE', entity: 'invoices', entity_id: originalId, diff: { status: 'REFUNDED', reason }, ip_address: meta.ip ?? null },
      ]).execute();

      return refund;
    });
  }
}
