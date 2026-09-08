import { InvoicesRepository } from './invoices.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { FilesRepository } from '../files/files.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import { splitInclusive } from '../quotes/quotes.util.js';
import { renderInvoiceEmail } from './invoices.email.js';
import { sendEmail } from '../../core/email/email.service.js';
import type { InvoiceRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type {
  IssueInvoiceDTO,
  InvoiceFilters,
  InvoiceRequestMeta,
  InvoiceListRow,
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
    const doc = await this.repository.findDocumentData(id);
    if (!doc) throw AppError.notFound(`Invoice ${id} not found`);
    return doc;
  }

  /** Email the invoice/receipt to the bill-to: the reservation's billing/accounts
   *  contact when one is assigned (A4), otherwise the guest. */
  async sendInvoiceToGuest(id: string, meta: InvoiceRequestMeta): Promise<{ sent: true; to: string }> {
    const doc = await this.repository.findDocumentData(id);
    if (!doc) throw AppError.notFound(`Invoice ${id} not found`);
    const to = doc.bill_to_email;
    if (!to) throw AppError.badRequest('This invoice has no billing or guest email on file.');
    const { subject, html } = renderInvoiceEmail(doc);
    await sendEmail({ to, subject, html });
    await this.repository.recordEmailSent(id, to, meta);
    return { sent: true, to };
  }

  async listInvoices(
    filters: InvoiceFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<InvoiceRow & InvoiceListRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async issueInvoice(dto: IssueInvoiceDTO, meta: InvoiceRequestMeta): Promise<InvoiceRow> {
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
   * Raise an invoice for money that has ALREADY been received, and mark it paid.
   *
   * The ordinary flow issues an invoice so someone can go and pay it. A payment taken
   * at the desk runs the other way round — the cash is in hand before any document
   * exists — so issuing it as ISSUED would put a settled booking into the Finance
   * cockpit's outstanding list and its debtor ageing, which is simply untrue.
   *
   * Two statements rather than one transaction because create() and settle() each own
   * their audit row; the pair is idempotent enough in practice (a failure between them
   * leaves an ISSUED invoice that Accounts can settle by hand, not a lost payment).
   */
  async issueSettledInvoice(dto: IssueInvoiceDTO, meta: InvoiceRequestMeta): Promise<InvoiceRow> {
    const invoice = await this.issueInvoice(dto, meta);
    return this.settleInvoice(invoice.id, null, meta);
  }

  async settleInvoice(id: string, receiptFileId: string | null | undefined, meta: InvoiceRequestMeta): Promise<InvoiceRow> {
    const invoice = await this.getInvoice(id);
    if (invoice.status === 'PAID') throw AppError.conflict('Invoice is already paid');
    if (invoice.status === 'REFUNDED' || invoice.status === 'VOID') {
      throw AppError.conflict(`Cannot settle a ${invoice.status} invoice`);
    }

    if (receiptFileId) {
      const file = await this.filesRepo.findById(receiptFileId);
      if (!file) throw AppError.badRequest('Invalid receipt_file_id');
    }

    const updated = await this.repository.settle(id, receiptFileId ?? null, meta);
    if (!updated) throw AppError.notFound(`Failed to settle invoice ${id}`);
    return updated;
  }

  async refundInvoice(id: string, amount: number, reason: string, meta: InvoiceRequestMeta): Promise<InvoiceRow> {
    const original = await this.getInvoice(id);
    if (original.status !== 'PAID') {
      throw AppError.conflict(`Only a PAID invoice can be refunded (current: ${original.status})`);
    }
    if (amount > original.total_amount) {
      throw AppError.badRequest('Refund amount exceeds the invoice total');
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
