// Build 2b (finish) — turn a recorded discount into a real "amount due".
//
// A reservation stores a discount (type/value) but no money; the price comes from
// the room's active rate plan. This applies the discount EXACTLY like a quote's
// pre-tax adjustment (discount the room subtotal, then tax, then deposit), so a
// discounted booking is priced identically to the commercial quote path.
import { taxExclusive, depositFrom } from '../quotes/quotes.util.js';

export type DiscountType = 'PERCENT' | 'FIXED';

/**
 * Thebe knocked off a pre-tax subtotal by a discount. PERCENT = % of subtotal,
 * FIXED = a flat thebe amount. Never negative and never more than the subtotal.
 */
export function discountAmount(subtotal: number, type: DiscountType, value: number): number {
  if (value <= 0 || subtotal <= 0) return 0;
  const raw = type === 'PERCENT' ? Math.round((subtotal * value) / 100) : value;
  return Math.min(Math.max(0, raw), subtotal);
}

export interface ReservationPricing {
  priceable: true;
  currency: string;
  nights: number;
  /** Pre-discount room subtotal (from the rate plan). */
  base_amount: number;
  discount: {
    type: DiscountType;
    value: number;
    reason: string | null;
    approved: boolean;
    /** Thebe actually applied — 0 until a manager approves it. */
    amount: number;
  } | null;
  /** Subtotal after an approved discount. */
  subtotal: number;
  tax_rate_bps: number;
  tax_amount: number;
  total_amount: number;
  deposit_pct: number;
  deposit_amount: number;
}

export interface NotPriceable {
  priceable: false;
  reason: string;
  nights: number;
}

/**
 * Compose the final breakdown from a priced stay + the booking's discount.
 * Only an APPROVED discount reduces the amount due — a requested-but-unapproved
 * discount is surfaced (so staff see it) but applies 0 thebe.
 */
export function buildReservationPricing(args: {
  currency: string;
  nights: number;
  baseAmount: number;
  taxRateBps: number;
  depositPct: number;
  discount: { type: DiscountType; value: number; reason: string | null; approved: boolean } | null;
}): ReservationPricing {
  const applied = args.discount?.approved
    ? discountAmount(args.baseAmount, args.discount.type, args.discount.value)
    : 0;
  const subtotal = args.baseAmount - applied;
  const taxAmount = taxExclusive(subtotal, args.taxRateBps);
  const totalAmount = subtotal + taxAmount;
  const depositAmount = depositFrom(totalAmount, args.depositPct);

  return {
    priceable: true,
    currency: args.currency,
    nights: args.nights,
    base_amount: args.baseAmount,
    discount: args.discount
      ? {
          type: args.discount.type,
          value: args.discount.value,
          reason: args.discount.reason,
          approved: args.discount.approved,
          amount: applied,
        }
      : null,
    subtotal,
    tax_rate_bps: args.taxRateBps,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    deposit_pct: args.depositPct,
    deposit_amount: depositAmount,
  };
}
