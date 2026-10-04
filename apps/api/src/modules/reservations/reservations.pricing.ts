// Build 2b (finish) — turn a recorded discount into a real "amount due".
//
// A reservation stores a discount (type/value) but no money; the price comes from
// the room's active rate plan. This applies the discount EXACTLY like a quote's
// pre-tax adjustment (discount the room subtotal, then tax, then deposit), so a
// discounted booking is priced identically to the commercial quote path.
import { taxExclusive, depositFrom, splitInclusive } from '../quotes/quotes.util.js';

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
    /** Thebe actually taken off the pre-VAT subtotal — 0 until a manager approves it. */
    amount: number;
    /** What the guest saves on the VAT-inclusive total. For FIXED it equals `value`. */
    off_total: number;
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
  const fullTotal = args.baseAmount + taxExclusive(args.baseAmount, args.taxRateBps);
  let applied: number;
  let subtotal: number;
  let taxAmount: number;
  let totalAmount: number;
  if (args.discount?.approved && args.discount.type === 'FIXED') {
    // (Owner decision 2026-10-04) "P200 off" means the guest pays exactly P200 less.
    // Rates are VAT-exclusive, so taking P200 off the pre-VAT subtotal saved the guest
    // P228 at 14%. Take it off the VAT-inclusive total instead and split what is left back
    // into subtotal + VAT (subtotal + tax === total, to the thebe).
    totalAmount = Math.max(0, fullTotal - Math.max(0, args.discount.value));
    ({ subtotal, tax: taxAmount } = splitInclusive(totalAmount, args.taxRateBps));
    applied = args.baseAmount - subtotal;
  } else {
    // A percentage is the same share before or after VAT, so it stays on the subtotal.
    applied = args.discount?.approved
      ? discountAmount(args.baseAmount, args.discount.type, args.discount.value)
      : 0;
    subtotal = args.baseAmount - applied;
    taxAmount = taxExclusive(subtotal, args.taxRateBps);
    totalAmount = subtotal + taxAmount;
  }
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
          off_total: fullTotal - totalAmount,
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
