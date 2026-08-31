import { z } from 'zod';

export const UnitTypeEnum = z.enum(['STANDARD', 'DELUXE', 'SUITE', 'CONFERENCE', 'CUSTOM']);
export type UnitType = z.infer<typeof UnitTypeEnum>;

export const CreateRatePlanSchema = z.object({
  unit_type: UnitTypeEnum,
  name: z.string().min(1).max(120),
  nightly_rate: z.number().int().positive(),
  weekly_rate: z.number().int().positive(),
  monthly_rate: z.number().int().positive(),
  min_nights: z.number().int().min(1).default(1),
  max_guests: z.number().int().min(1).default(4),
  deposit_pct: z.number().int().min(0).max(100).default(50),
  // Zero-rated by default (migration 063): Lifestyle's advertised rate IS the
  // price paid, and the engine adds tax on top rather than splitting it out.
  tax_rate_bps: z.number().int().min(0).max(10000).default(0),
  currency: z.string().length(3).default('BWP'),
  active: z.boolean().default(true),
});

export const UpdateRatePlanSchema = CreateRatePlanSchema.partial();

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
