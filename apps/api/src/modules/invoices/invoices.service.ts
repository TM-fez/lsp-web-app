import crypto from 'node:crypto';
import { InvoicesRepository } from './invoices.repository.js';
import { QuotesService } from '../quotes/quotes.service.js';
import { FilesRepository } from '../files/files.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import { splitInclusive } from '../quotes/quotes.util.js';
import type { InvoiceRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type {
  IssueInvoiceDTO,
  InvoiceFilters,
  InvoiceRequestMeta,
} from './invoices.types.js';

function invoiceNumber(): string {
  const rand = crypto.randomUUID().split('-')[0]!.toUpperCase();
  return `INV-${new Date().getFullYear()}-${rand}`;
}

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

  async listInvoices(filters: InvoiceFilters, pagination: PaginationOptions): Promise<PaginatedResult<InvoiceRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async issueInvoice(dto: IssueInvoiceDTO, meta: InvoiceRequestMeta): Promise<InvoiceRow> {
    const quote = await this.quotes.getQuote(dto.quote_id);

    const total =
      dto.kind === 'DEPOSIT'
        ? quote.deposit_amount
        : quote.total_amount - quote.deposit_amount;

    if (total <= 0) {
      throw AppError.badRequest(`Nothing to invoice for kind ${dto.kind} on this quote`);
    }

    const { subtotal, tax } = splitInclusive(total, quote.tax_rate_bps);

    return this.repository.create(
      {
        number: invoiceNumber(),
        hold_id: dto.hold_id ?? null,
        quote_id: quote.id,
        reservation_id: dto.reservation_id ?? null,
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
        number: invoiceNumber(),
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
