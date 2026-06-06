import { describe, it, expect, vi } from 'vitest';
import { PricingService } from '../../../../src/modules/pricing/pricing.service.js';

const plan = (over: Record<string, unknown> = {}) =>
  ({
    id: 'rp1',
    unit_type: 'STANDARD',
    name: 'Standard',
    nightly_rate: 10000,
    weekly_rate: 60000,
    monthly_rate: 200000,
    min_nights: 1,
    max_guests: 2,
    deposit_pct: 50,
    tax_rate_bps: 1400,
    currency: 'BWP',
    active: true,
    created_by: 'u',
    updated_by: 'u',
    deleted_at: null,
    deleted_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  }) as any;

describe('PricingService.priceStay', () => {
  const svc = new PricingService({} as any);

  it('prices a single night at the nightly rate', () => {
    const r = svc.priceStay(plan(), 1);
    expect(r.base_amount).toBe(10000);
    expect(r.segments).toEqual([{ unit: 'night', count: 1, unit_rate: 10000, amount: 10000 }]);
  });

  it('uses the weekly rate when it beats 7 nights', () => {
    const r = svc.priceStay(plan(), 7);
    expect(r.base_amount).toBe(60000);
    expect(r.segments).toEqual([{ unit: 'week', count: 1, unit_rate: 60000, amount: 60000 }]);
  });

  it('mixes a month with the remaining nights (35 nights)', () => {
    const r = svc.priceStay(plan(), 35); // month 200000 + 5 nights 50000
    expect(r.base_amount).toBe(250000);
  });

  it('overshoots to a cheaper weekly block for a 5-night stay', () => {
    const r = svc.priceStay(plan({ weekly_rate: 40000 }), 5); // 5*10000=50000 vs week 40000
    expect(r.base_amount).toBe(40000);
    expect(r.segments).toEqual([{ unit: 'week', count: 1, unit_rate: 40000, amount: 40000 }]);
  });

  it('decomposes 10 nights as 1 week + 3 nights', () => {
    const r = svc.priceStay(plan(), 10);
    expect(r.base_amount).toBe(90000);
  });
});

describe('PricingService.previewPrice', () => {
  it('returns a breakdown for the active plan', async () => {
    const repo = { findActiveByUnitType: vi.fn().mockResolvedValue(plan()) } as any;
    const svc = new PricingService(repo);
    const r = await svc.previewPrice('STANDARD', 10);
    expect(r.rate_plan_id).toBe('rp1');
    expect(r.base_amount).toBe(90000);
    expect(r.tax_rate_bps).toBe(1400);
    expect(r.deposit_pct).toBe(50);
  });

  it('throws when no active plan exists', async () => {
    const repo = { findActiveByUnitType: vi.fn().mockResolvedValue(undefined) } as any;
    const svc = new PricingService(repo);
    await expect(svc.previewPrice('SUITE', 3)).rejects.toThrow('No active rate plan');
  });
});
