import { describe, it, expect } from 'vitest';
import {
  discountAmount,
  buildReservationPricing,
} from '../../../src/modules/reservations/reservations.pricing.js';

describe('discountAmount', () => {
  it('takes a percentage of the subtotal', () => {
    expect(discountAmount(100_000, 'PERCENT', 15)).toBe(15_000);
  });

  it('takes a flat thebe amount for FIXED', () => {
    expect(discountAmount(100_000, 'FIXED', 25_000)).toBe(25_000);
  });

  it('never knocks off more than the subtotal', () => {
    expect(discountAmount(20_000, 'FIXED', 50_000)).toBe(20_000);
    expect(discountAmount(20_000, 'PERCENT', 100)).toBe(20_000);
  });

  it('ignores zero / negative / empty inputs', () => {
    expect(discountAmount(100_000, 'PERCENT', 0)).toBe(0);
    expect(discountAmount(0, 'FIXED', 5_000)).toBe(0);
  });
});

describe('buildReservationPricing', () => {
  const base = {
    currency: 'BWP',
    nights: 5,
    baseAmount: 100_000, // P1,000.00
    taxRateBps: 1400, // 14%
    depositPct: 50,
  };

  it('prices a stay with no discount', () => {
    const p = buildReservationPricing({ ...base, discount: null });
    expect(p.discount).toBeNull();
    expect(p.subtotal).toBe(100_000);
    expect(p.tax_amount).toBe(14_000);
    expect(p.total_amount).toBe(114_000);
    expect(p.deposit_amount).toBe(57_000);
  });

  it('does NOT apply a discount that is only requested (not approved)', () => {
    const p = buildReservationPricing({
      ...base,
      discount: { type: 'PERCENT', value: 10, reason: 'loyal guest', approved: false },
    });
    expect(p.discount?.amount).toBe(0); // surfaced, but 0 thebe applied
    expect(p.total_amount).toBe(114_000); // unchanged from full price
  });

  it('applies an approved percentage discount before tax, then recomputes deposit', () => {
    const p = buildReservationPricing({
      ...base,
      discount: { type: 'PERCENT', value: 10, reason: null, approved: true },
    });
    expect(p.discount?.amount).toBe(10_000);
    expect(p.subtotal).toBe(90_000);
    expect(p.tax_amount).toBe(12_600);
    expect(p.total_amount).toBe(102_600);
    expect(p.deposit_amount).toBe(51_300);
  });
});
