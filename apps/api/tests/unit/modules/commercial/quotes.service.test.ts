import { describe, it, expect, vi } from 'vitest';
import { QuotesService } from '../../../../src/modules/quotes/quotes.service.js';

const plan = { id: 'rp1', tax_rate_bps: 1400, deposit_pct: 50, max_guests: 2, min_nights: 1, currency: 'BWP' } as any;

function makeService() {
  const repo = {
    create: vi.fn(async (v: any) => ({ id: 'q1', ...v })),
    findById: vi.fn(),
    findPaginated: vi.fn(),
    markStatus: vi.fn(),
    expireStale: vi.fn(),
  } as any;
  const pricing = {
    getActivePlan: vi.fn().mockResolvedValue(plan),
    priceStay: vi.fn().mockReturnValue({ base_amount: 100000, currency: 'BWP', segments: [] }),
  } as any;
  return { svc: new QuotesService(repo, pricing), repo, pricing };
}

const baseDto = {
  unit_type: 'STANDARD',
  check_in: new Date('2026-01-01'),
  check_out: new Date('2026-01-04'),
  guests: 1,
};

describe('QuotesService.createQuote', () => {
  it('computes nights, tax (14%), total and deposit (50%)', async () => {
    const { svc, repo } = makeService();
    await svc.createQuote(baseDto as any, { userId: 'u1' });
    const arg = repo.create.mock.calls[0][0];
    expect(arg.nights).toBe(3);
    expect(arg.base_amount).toBe(100000);
    expect(arg.tax_amount).toBe(14000);
    expect(arg.total_amount).toBe(114000);
    expect(arg.deposit_amount).toBe(57000);
    expect(arg.status).toBeUndefined(); // DB default ACTIVE
  });

  it('rejects a manual adjustment without pricing.override', async () => {
    const { svc } = makeService();
    const dto = { ...baseDto, adjustment_amount: -5000, adjustment_reason: 'loyalty' };
    await expect(svc.createQuote(dto as any, { userId: 'u1', canOverride: false })).rejects.toThrow('pricing.override');
  });

  it('requires a reason when adjusting price', async () => {
    const { svc } = makeService();
    const dto = { ...baseDto, adjustment_amount: -5000 };
    await expect(svc.createQuote(dto as any, { userId: 'u1', canOverride: true })).rejects.toThrow('adjustment_reason');
  });

  it('records override_by when an authorised adjustment is applied', async () => {
    const { svc, repo } = makeService();
    const dto = { ...baseDto, adjustment_amount: -10000, adjustment_reason: 'corporate rate' };
    await svc.createQuote(dto as any, { userId: 'mgr', canOverride: true });
    const arg = repo.create.mock.calls[0][0];
    expect(arg.adjustment_amount).toBe(-10000);
    expect(arg.override_by).toBe('mgr');
    expect(arg.total_amount).toBe(102600); // (100000-10000)=90000 +14% tax 12600
  });
});

describe('QuotesService.assertUsable', () => {
  const { svc } = makeService();
  it('throws for a consumed quote', () => {
    expect(() => svc.assertUsable({ status: 'CONSUMED', expires_at: new Date(Date.now() + 1e6) } as any)).toThrow('already been used');
  });
  it('throws for an expired quote', () => {
    expect(() => svc.assertUsable({ status: 'ACTIVE', expires_at: new Date(Date.now() - 1000) } as any)).toThrow('expired');
  });
  it('passes for an active, unexpired quote', () => {
    expect(() => svc.assertUsable({ status: 'ACTIVE', expires_at: new Date(Date.now() + 1e6) } as any)).not.toThrow();
  });
});
