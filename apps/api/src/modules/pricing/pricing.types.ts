import { z } from 'zod';
import { MAX_MONEY_THEBE } from '../../core/money/limits.js';

export const UnitTypeEnum = z.enum(['STANDARD', 'DELUXE', 'SUITE', 'CONFERENCE', 'CUSTOM']);
export type UnitType = z.infer<typeof UnitTypeEnum>;

const rate = z.number().int().positive().max(MAX_MONEY_THEBE, 'A rate cannot be more than P1,000,000');

/**
 * (Round 4) A longer block can never cost less than the shorter block inside it. The price
 * engine buys "the cheapest mix of month/week/night blocks" with overshoot, so a weekly rate
 * below the nightly rate would price a ONE-night stay as the whole week, and a monthly rate
 * below the weekly rate would do the same one level up. Checked only for rates actually
 * supplied; an update that sends one rate is checked against the stored others in the service.
 */
export function ratesOutOfOrder(r: { nightly_rate?: number; weekly_rate?: number; monthly_rate?: number }): string | null {
  if (r.nightly_rate !== undefined && r.weekly_rate !== undefined && r.weekly_rate < r.nightly_rate) {
    return 'The weekly rate cannot be lower than the nightly rate — a week costs at least one night.';
  }
  if (r.weekly_rate !== undefined && r.monthly_rate !== undefined && r.monthly_rate < r.weekly_rate) {
    return 'The monthly rate cannot be lower than the weekly rate — a month costs at least one week.';
  }
  return null;
}

const RatePlanBase = z.object({
  unit_type: UnitTypeEnum,
  name: z.string().min(1).max(120),
  nightly_rate: rate,
  weekly_rate: rate,
  monthly_rate: rate,
  min_nights: z.number().int().min(1).default(1),
  max_guests: z.number().int().min(1).default(4),
  deposit_pct: z.number().int().min(0).max(100).default(50),
  // Zero-rated by default (migration 063): Lifestyle's advertised rate IS the
  // price paid, and the engine adds tax on top rather than splitting it out.
  tax_rate_bps: z.number().int().min(0).max(10000).default(0),
  currency: z.string().length(3).default('BWP'),
  active: z.boolean().default(true),
});

const checkRateOrder = (r: Parameters<typeof ratesOutOfOrder>[0], ctx: z.RefinementCtx) => {
  const message = ratesOutOfOrder(r);
  if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['weekly_rate'] });
};
export const CreateRatePlanSchema = RatePlanBase.superRefine(checkRateOrder);
export const UpdateRatePlanSchema = RatePlanBase.partial().superRefine(checkRateOrder);

export type CreateRatePlanDTO = z.infer<typeof CreateRatePlanSchema>;
export type UpdateRatePlanDTO = z.infer<typeof UpdateRatePlanSchema>;

export interface RatePlanFilters {
  unit_type?: UnitType;
  active?: boolean;
}

// ── Pricing computation output (also embedded into a quote breakdown) ─────────

export interface PriceSegment {
  unit: 'month' | 'week' | 'night';
  count: number;
  unit_rate: number; // thebe
  amount: number;    // thebe = count * unit_rate
}

export interface PriceResult {
  base_amount: number; // thebe
  currency: string;
  segments: PriceSegment[];
}

export interface PricingRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}
