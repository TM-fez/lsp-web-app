import { Kysely, sql } from 'kysely';
import type { Database, InvoiceRow, NewInvoice } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { InvoiceFilters, InvoiceStatus, InvoiceRequestMeta } from './invoices.types.js';

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

  // Everything a printable invoice/receipt needs: the invoice + the guest + the stay.
  async findDocumentData(id: string) {
    return this.db
      .selectFrom('invoices as i')
      .leftJoin('reservations as rsv', 'rsv.id', 'i.reservation_id')
      .leftJoin('contacts as c', 'c.id', 'rsv.contact_id')
      .leftJoin('rooms as rm', 'rm.id', 'rsv.room_id')
      .leftJoin('quotes as q', 'q.id', 'i.quote_id')
      .select([
        'i.id', 'i.number', 'i.kind', 'i.status', 'i.currency',
        'i.subtotal_amount', 'i.tax_rate_bps', 'i.tax_amount', 'i.total_amount', 'i.created_at',
        'c.name as guest_name', 'c.email as guest_email', 'c.phone as guest_phone',
        sql<string | null>`to_char(rsv.check_in_date, 'YYYY-MM-DD')`.as('check_in_date'),
        sql<string | null>`to_char(rsv.check_out_date, 'YYYY-MM-DD')`.as('check_out_date'),
        'rm.code as unit_code', 'rm.name as unit_name', 'q.nights', 'q.unit_type',
      ])
      .where('i.id', '=', id)
      .where('i.deleted_at', 'is', null)
      .executeTakeFirst();
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
  ): Promise<PaginatedResult<InvoiceRow>> {
    let query = this.db.selectFrom('invoices').selectAll().where('deleted_at', 'is', null);
    let countQuery = this.db
      .selectFrom('invoices')
      .select(this.db.fn.count<number>('id').as('total'))
      .where('deleted_at', 'is', null);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
      countQuery = countQuery.where('status', '=', filters.status);
    }
    if (filters.kind) {
      query = query.where('kind', '=', filters.kind);
      countQuery = countQuery.where('kind', '=', filters.kind);
    }
    if (filters.quote_id) {
      query = query.where('quote_id', '=', filters.quote_id);
      countQuery = countQuery.where('quote_id', '=', filters.quote_id);
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
