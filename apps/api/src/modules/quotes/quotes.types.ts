import { z } from 'zod';
import { MAX_MONEY_THEBE } from '../../core/money/limits.js';
import { UnitTypeEnum, type UnitType } from '../pricing/pricing.types.js';
import type { PriceSegment } from '../pricing/pricing.types.js';

export const QuoteStatusEnum = z.enum(['ACTIVE', 'EXPIRED', 'CONSUMED']);
export type QuoteStatus = z.infer<typeof QuoteStatusEnum>;

export const CreateQuoteSchema = z
  .object({
    unit_type: UnitTypeEnum,
    check_in: z.coerce.date(),
    check_out: z.coerce.date(),
    guests: z.number().int().min(1).default(1),
    // Signed manual adjustment in thebe (negative = discount). Requires pricing.override.
    adjustment_amount: z.number().int().min(-MAX_MONEY_THEBE).max(MAX_MONEY_THEBE, 'That amount is too large — the most one entry can be is P1,000,000.').optional(),
    adjustment_reason: z.string().max(500).optional().nullable(),
  })
  .refine((d) => d.check_in < d.check_out, {
    message: 'check_out must be after check_in',
    path: ['check_out'],
  });

export type CreateQuoteDTO = z.infer<typeof CreateQuoteSchema>;

/**
 * (Round 4, N-9) Who is asking, for quote visibility. A quote has no property column — it is
 * priced by unit type — so a limited user sees a quote they created, or one whose hold sits
 * in one of their properties. `ids` null = admin; `allProperties` sees every quote.
 */
export interface QuoteScope {
  userId: string;
  ids: string[] | null;
  allProperties: boolean;
}

export interface QuoteFilters {
  status?: QuoteStatus;
  unit_type?: UnitType;
}

export interface QuoteBreakdown {
  segments: PriceSegment[];
  base_amount: number;
  adjustment_amount: number;
  adjustment_reason: string | null;
  subtotal: number;
  tax_rate_bps: number;
  tax_amount: number;
  deposit_pct: number;
  deposit_amount: number;
  total_amount: number;
  currency: string;
}

export interface QuoteRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
  /** True when the caller holds pricing.override (set by the controller from JWT). */
  canOverride?: boolean;
}
