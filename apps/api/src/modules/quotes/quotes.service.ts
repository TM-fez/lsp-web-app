import { QuotesRepository } from './quotes.repository.js';
import { PricingService } from '../pricing/pricing.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { nightsBetween, taxExclusive, depositFrom } from './quotes.util.js';
import type { QuoteRow } from '../../db/types.js';
import type { PaginatedResult, PaginationOptions } from '../crm/crm.types.js';
import type { CreateQuoteDTO, QuoteFilters, QuoteBreakdown, QuoteRequestMeta } from './quotes.types.js';

const QUOTE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export class QuotesService {
  constructor(
    private readonly repository: QuotesRepository,
    private readonly pricing: PricingService
  ) {}

  async getQuote(id: string): Promise<QuoteRow> {
    const quote = await this.repository.findById(id);
    if (!quote) throw AppError.notFound(`Quote ${id} not found`);
    return quote;
  }

  async listQuotes(filters: QuoteFilters, pagination: PaginationOptions): Promise<PaginatedResult<QuoteRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  /** Throws unless the quote is ACTIVE and not past its expiry. */
  assertUsable(quote: QuoteRow): void {
    if (quote.status === 'CONSUMED') throw AppError.conflict('Quote has already been used');
    if (quote.status === 'EXPIRED' || quote.expires_at < new Date()) {
      throw AppError.conflict('Quote has expired');
    }
  }

  async createQuote(dto: CreateQuoteDTO, meta: QuoteRequestMeta): Promise<QuoteRow> {
    const nights = nightsBetween(dto.check_in, dto.check_out);
    const plan = await this.pricing.getActivePlan(dto.unit_type);

    if (nights < plan.min_nights) {
      throw AppError.badRequest(`Minimum stay for ${dto.unit_type} is ${plan.min_nights} night(s)`);
    }
    if (dto.guests > plan.max_guests) {
      throw AppError.badRequest(`Maximum ${plan.max_guests} guest(s) for ${dto.unit_type}`);
    }

    const adjustment = dto.adjustment_amount ?? 0;
    if (adjustment !== 0) {
      if (!meta.canOverride) throw AppError.forbidden('Price adjustment requires pricing.override');
      if (!dto.adjustment_reason) throw AppError.badRequest('adjustment_reason is required when adjusting price');
    }

    const price = this.pricing.priceStay(plan, nights);
    const subtotal = Math.max(0, price.base_amount + adjustment);
    const taxAmount = taxExclusive(subtotal, plan.tax_rate_bps);
    const totalAmount = subtotal + taxAmount;
    const depositAmount = depositFrom(totalAmount, plan.deposit_pct);

    const breakdown: QuoteBreakdown = {
      segments: price.segments,
      base_amount: price.base_amount,
      adjustment_amount: adjustment,
      adjustment_reason: dto.adjustment_reason ?? null,
      subtotal,
      tax_rate_bps: plan.tax_rate_bps,
      tax_amount: taxAmount,
      deposit_pct: plan.deposit_pct,
      deposit_amount: depositAmount,
      total_amount: totalAmount,
      currency: plan.currency,
    };

    return this.repository.create(
      {
        rate_plan_id: plan.id,
        unit_type: dto.unit_type,
        check_in_date: dto.check_in,
        check_out_date: dto.check_out,
        guests: dto.guests,
        nights,
        currency: plan.currency,
        base_amount: price.base_amount,
        adjustment_amount: adjustment,
        adjustment_reason: dto.adjustment_reason ?? null,
        tax_rate_bps: plan.tax_rate_bps,
        tax_amount: taxAmount,
        deposit_amount: depositAmount,
        total_amount: totalAmount,
        breakdown,
        created_by: meta.userId,
        override_by: adjustment !== 0 ? meta.userId : null,
        expires_at: new Date(Date.now() + QUOTE_TTL_MS),
      },
      meta
    );
  }

  async expireStaleQuotes(): Promise<number> {
    return this.repository.expireStale();
  }
}
