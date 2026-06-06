import { describe, it, expect, vi } from 'vitest';
import { InvoicesService } from '../../../../src/modules/invoices/invoices.service.js';

function setup() {
  const repo = {
    findById: vi.fn(),
    findPaginated: vi.fn(),
    create: vi.fn(async (v: any) => ({ id: 'inv1', ...v })),
    settle: vi.fn(async (id: string) => ({ id, status: 'PAID' })),
    markStatus: vi.fn(),
    refund: vi.fn(async (_id: string, v: any) => ({ id: 'inv2', ...v })),
  } as any;
  const quotes = {
    getQuote: vi.fn().mockResolvedValue({
      id: 'q1',
      deposit_amount: 57000,
      total_amount: 114000,
      tax_rate_bps: 1400,
      currency: 'BWP',
    }),
  } as any;
  const files = { findById: vi.fn() } as any;
  return { svc: new InvoicesService(repo, quotes, files), repo, quotes, files };
}

describe('InvoicesService.issueInvoice', () => {
  it('splits a deposit into VAT-inclusive subtotal + tax', async () => {
    const { svc, repo } = setup();
    await svc.issueInvoice({ quote_id: 'q1', kind: 'DEPOSIT' } as any, { userId: 'u1' });
    const arg = repo.create.mock.calls[0][0];
    expect(arg.total_amount).toBe(57000);
    expect(arg.subtotal_amount).toBe(50000);
    expect(arg.tax_amount).toBe(7000);
    expect(arg.kind).toBe('DEPOSIT');
    expect(arg.number).toMatch(/^INV-/);
  });

  it('invoices the remaining balance', async () => {
    const { svc, repo } = setup();
    await svc.issueInvoice({ quote_id: 'q1', kind: 'BALANCE' } as any, { userId: 'u1' });
    expect(repo.create.mock.calls[0][0].total_amount).toBe(57000); // 114000 - 57000
  });
});

describe('InvoicesService.settleInvoice', () => {
  it('rejects settling an already-paid invoice', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'inv1', status: 'PAID' });
    await expect(svc.settleInvoice('inv1', null, { userId: 'u1' })).rejects.toThrow('already paid');
  });

  it('rejects an invalid receipt file reference', async () => {
    const { svc, repo, files } = setup();
    repo.findById.mockResolvedValue({ id: 'inv1', status: 'ISSUED' });
    files.findById.mockResolvedValue(null);
    await expect(svc.settleInvoice('inv1', 'file-x', { userId: 'u1' })).rejects.toThrow('Invalid receipt_file_id');
  });

  it('settles an issued invoice', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'inv1', status: 'ISSUED' });
    const r = await svc.settleInvoice('inv1', null, { userId: 'u1' });
    expect(repo.settle).toHaveBeenCalled();
    expect(r.status).toBe('PAID');
  });
});

describe('InvoicesService.refundInvoice', () => {
  it('refunds a paid invoice', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({
      id: 'inv1', status: 'PAID', total_amount: 57000, tax_rate_bps: 1400,
      currency: 'BWP', hold_id: null, quote_id: 'q1', reservation_id: null,
    });
    await svc.refundInvoice('inv1', 57000, 'guest cancelled', { userId: 'u1' });
    expect(repo.refund).toHaveBeenCalled();
    const arg = repo.refund.mock.calls[0][1];
    expect(arg.kind).toBe('REFUND');
    expect(arg.total_amount).toBe(57000);
  });

  it('rejects a refund larger than the invoice total', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'inv1', status: 'PAID', total_amount: 57000, tax_rate_bps: 1400 });
    await expect(svc.refundInvoice('inv1', 99999, 'x', { userId: 'u1' })).rejects.toThrow('exceeds');
  });

  it('rejects refunding an unpaid invoice', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'inv1', status: 'ISSUED', total_amount: 57000 });
    await expect(svc.refundInvoice('inv1', 1000, 'x', { userId: 'u1' })).rejects.toThrow('PAID');
  });
});
