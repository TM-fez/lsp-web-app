import { InvoicesRepository } from './invoices.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { FilesRepository } from '../files/files.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import { splitInclusive } from '../quotes/quotes.util.js';
import { renderInvoiceEmail } from './invoices.email.js';
import { sendEmail } from '../../core/email/email.service.js';
import type { InvoiceRow } from '../../db/types.js';
import type { PaginationOptions } from '../crm/crm.types.js';
import type {
  IssueInvoiceDTO,
  InvoiceFilters,
  InvoiceRequestMeta,
  InvoiceListResult,
} from './invoices.types.js';

export class InvoicesService {
  constructor(
    private readonly repository: InvoicesRepository,
    private readonly quotes: QuotesService,
    private readonly filesRepo: FilesRepository
  ) {}

  async getInvoice(id: string): Promise<InvoiceRow> {
    const invoice = await this.repository.findById(id);
    if (!invoice) throw AppError.notFound(`Invoice ${id} not found`);
    return invoice;
  }

  /** Enriched data for a printable invoice/receipt (invoice + guest + stay). */
  async getInvoiceDocument(id: string) {
    const [doc, company] = await Promise.all([this.repository.findDocumentData(id), this.repository.companyDetails()]);
    if (!doc) throw AppError.notFound(`Invoice ${id} not found`);
    return { ...doc, company };
  }

  /** Email the invoice/receipt to the bill-to: the reservation's billing/accounts
   *  contact when one is assigned (A4), otherwise the guest. */
  async sendInvoiceToGuest(id: string, meta: InvoiceRequestMeta): Promise<{ sent: true; to: string }> {
    const doc = await this.repository.findDocumentData(id);
    if (!doc) throw AppError.notFound(`Invoice ${id} not found`);
    const to = doc.bill_to_email;
    if (!to) throw AppError.badRequest('This invoice has no billing or guest email on file.');
    const { subject, html } = renderInvoiceEmail(doc, await this.repository.companyDetails());
    await sendEmail({ to, subject, html });
    await this.repository.recordEmailSent(id, to, meta);
    return { sent: true, to };
  }

  async listInvoices(
    filters: InvoiceFilters,
    pagination: PaginationOptions
  ): Promise<InvoiceListResult> {
    return this.repository.findPaginated(filters, pagination);
  }

  /**
   * A booking an invoice is about to be attached to must EXIST and sit in the caller's
   * active property. The route guard checks a reservation_id carried in the body, but the
   * reservation can also be DERIVED (quote → hold → reservation), and the old code
   * attached whatever it was given: a user in one property could invoice another
   * property's booking, and a made-up id surfaced as a foreign-key error. "Not found"
   * either way — a booking outside your property is not yours to learn about.
   */
  private async assertReservationInScope(
    reservationId: string | null,
    activePropertyId?: string
  ): Promise<void> {
    if (!reservationId) return;
    const found = await this.repository.findReservationProperty(reservationId);
    if (!found || (activePropertyId && found.property_id !== activePropertyId)) {
      throw AppError.notFound('That booking could not be found.');
    }
  }

  async issueInvoice(
    dto: IssueInvoiceDTO,
    meta: InvoiceRequestMeta,
    activePropertyId?: string
  ): Promise<InvoiceRow> {
    const quote = await this.quotes.getQuote(dto.quote_id);

    // An explicit amount wins: a payment taken at the desk is for whatever the guest
    // actually handed over, which need not be the quote's deposit/balance split.
    const total =
      dto.amount ??
      (dto.kind === 'DEPOSIT' ? quote.deposit_amount : quote.total_amount - quote.deposit_amount);

    if (total <= 0) {
      throw AppError.badRequest(`Nothing to invoice for kind ${dto.kind} on this quote`);
    }
    if (total > quote.total_amount) {
      throw AppError.badRequest('An invoice cannot be raised for more than the quote total.');
    }

    // Attribute the invoice to a stay whenever one can be found. The Invoices screen
    // raises against a quote alone, and a quote prices a unit TYPE — it carries no
    // guest — so without this back-fill those invoices stay anonymous forever and
    // Accounts cannot tell who has not paid.
    const reservationId =
      dto.reservation_id ?? (await this.repository.findReservationIdForQuote(quote.id));
    await this.assertReservationInScope(reservationId, activePropertyId);

    const { subtotal, tax } = splitInclusive(total, quote.tax_rate_bps);

    return this.repository.create(
      {
        hold_id: dto.hold_id ?? null,
        quote_id: quote.id,
        reservation_id: reservationId,
        kind: dto.kind,
        currency: quote.currency,
        subtotal_amount: subtotal,
        tax_rate_bps: quote.tax_rate_bps,
        tax_amount: tax,
        total_amount: total,
        issued_by: meta.userId,
        created_by: meta.userId,
        updated_by: meta.userId,
      },
      meta
    );
  }

  /**
   * Raise an invoice for money that has ALREADY been received, born PAID.
   *
   * The ordinary flow issues an invoice so someone can go and pay it. A payment taken
   * at the desk runs the other way round — the cash is in hand before any document
   * exists — so issuing it as ISSUED would put a settled booking into the Finance
   * cockpit's outstanding list and its debtor ageing, which is simply untrue.
   *
   * One insert, one transaction. It used to be issueInvoice() then settleInvoice() — two
   * transactions, and the comment admitted a crash between them left an ISSUED invoice for
   * money in hand. (The live payment paths no longer come through here at all: they raise
   * the receipt inside the payment's own transaction. This remains for the backfill, which
   * records receipts for payments that predate that.)
   */
  async issueSettledInvoice(dto: IssueInvoiceDTO, meta: InvoiceRequestMeta): Promise<InvoiceRow> {
    const quote = await this.quotes.getQuote(dto.quote_id);
    const total =
      dto.amount ??
      (dto.kind === 'DEPOSIT' ? quote.deposit_amount : quote.total_amount - quote.deposit_amount);
    if (total <= 0) {
      throw AppError.badRequest(`Nothing to invoice for kind ${dto.kind} on this quote`);
    }
    if (total > quote.total_amount) {
      throw AppError.badRequest('An invoice cannot be raised for more than the quote total.');
    }
    const reservationId =
      dto.reservation_id ?? (await this.repository.findReservationIdForQuote(quote.id));
    const { subtotal, tax } = splitInclusive(total, quote.tax_rate_bps);

    return this.repository.create(
      {
        hold_id: dto.hold_id ?? null,
        quote_id: quote.id,
        reservation_id: reservationId,
        kind: dto.kind,
        currency: quote.currency,
        subtotal_amount: subtotal,
        tax_rate_bps: quote.tax_rate_bps,
        tax_amount: tax,
        total_amount: total,
        status: 'PAID',
        issued_by: meta.userId,
        created_by: meta.userId,
        updated_by: meta.userId,
      },
      meta
    );
  }

  /**
   * Mark an open invoice paid. The guards that matter (is it still open, would it collect
   * more than the booking owes, is the payment recorded, is what remains re-sized) all live
   * in the repository, in ONE transaction under the booking's lock — checking them here
   * and writing later is exactly the read-then-write race that let two clicks collect twice.
   * What stays here is the cheap early refusal with a friendly message, and the receipt file.
   */
  async settleInvoice(
    id: string,
    receiptFileId: string | null | undefined,
    meta: InvoiceRequestMeta,
    method?: 'CARD' | 'MOBILE_MONEY' | 'EFT' | 'CASH' | 'CORPORATE_CREDIT' | 'OTHER'
  ): Promise<InvoiceRow> {
    const invoice = await this.getInvoice(id);
    if (invoice.status === 'PAID') throw AppError.conflict('Invoice is already paid');
    if (invoice.status === 'REFUNDED' || invoice.status === 'VOID') {
      throw AppError.conflict(`Cannot settle a ${invoice.status} invoice`);
    }

    if (receiptFileId) {
      const file = await this.filesRepo.findById(receiptFileId);
      if (!file) throw AppError.badRequest('Invalid receipt_file_id');
    }

    const updated = await this.repository.settle(
      id,
      { receiptFileId: receiptFileId ?? null, method: method ?? 'OTHER' },
      meta
    );
    if (!updated) throw AppError.notFound(`Failed to settle invoice ${id}`);
    return updated;
  }

  async refundInvoice(id: string, amount: number, reason: string, meta: InvoiceRequestMeta): Promise<InvoiceRow> {
    // Fast, friendly refusals. The authoritative checks — including "how much is left"
    // after earlier partial refunds — run again in the repository under the invoice's row
    // lock, because a check here alone would race a second click.
    const original = await this.getInvoice(id);
    if (original.kind === 'REFUND') throw AppError.conflict('A refund can’t itself be refunded.');
    if (original.status !== 'PAID') {
      throw AppError.conflict(
        original.status === 'REFUNDED'
          ? 'This invoice has already been refunded in full.'
          : `Only a paid invoice can be refunded (this one is ${original.status}).`
      );
    }
    if (amount > original.total_amount) {
      throw AppError.badRequest('A refund can’t be more than the invoice total.');
    }

    const { subtotal, tax } = splitInclusive(amount, original.tax_rate_bps);

    return this.repository.refund(
      id,
      {
        hold_id: original.hold_id,
        quote_id: original.quote_id,
        reservation_id: original.reservation_id,
        kind: 'REFUND',
        currency: original.currency,
        subtotal_amount: subtotal,
        tax_rate_bps: original.tax_rate_bps,
        tax_amount: tax,
        total_amount: amount,
        status: 'PAID',
        issued_by: meta.userId,
        created_by: meta.userId,
        updated_by: meta.userId,
      },
      reason,
      meta
    );
  }
}
