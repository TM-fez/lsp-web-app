import { describe, it, expect, vi } from 'vitest';
import { InvoicesService } from '../../../../src/modules/invoices/invoices.service.js';

function setup() {
  const repo = {
    findById: vi.fn(),
    findPaginated: vi.fn(),
    // Back-fills the stay behind a quote so the invoice is attributable. Null here =
    // the quote never became a hold, which is the anonymous-invoice case.
    findReservationIdForQuote: vi.fn(async () => null),
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

  // A payment taken at the desk is for whatever the guest handed over — not
  // necessarily the quote's 50/50 deposit-then-balance split.
  it('honours an explicit amount over the quote slice', async () => {
    const { svc, repo } = setup();
    await svc.issueInvoice({ quote_id: 'q1', kind: 'BALANCE', amount: 114000 } as any, { userId: 'u1' });
    expect(repo.create.mock.calls[0][0].total_amount).toBe(114000);
  });

  it('refuses an amount larger than the quote it is raised against', async () => {
    const { svc } = setup();
    await expect(
      svc.issueInvoice({ quote_id: 'q1', kind: 'BALANCE', amount: 200000 } as any, { userId: 'u1' }),
    ).rejects.toThrow('cannot be raised for more than the quote total');
  });

  // Without this the Invoices screen produces invoices with no guest on them at all,
  // which is exactly why the list could not say who had paid.
  it('back-fills the reservation from the quote\u2019s hold when none is given', async () => {
    const { svc, repo } = setup();
    repo.findReservationIdForQuote.mockResolvedValue('res-9');
    await svc.issueInvoice({ quote_id: 'q1', kind: 'DEPOSIT' } as any, { userId: 'u1' });
    expect(repo.create.mock.calls[0][0].reservation_id).toBe('res-9');
  });

  it('prefers an explicitly supplied reservation over the back-fill', async () => {
    const { svc, repo } = setup();
    repo.findReservationIdForQuote.mockResolvedValue('res-9');
    await svc.issueInvoice(
      { quote_id: 'q1', kind: 'DEPOSIT', reservation_id: 'res-explicit' } as any,
      { userId: 'u1' },
    );
    expect(repo.create.mock.calls[0][0].reservation_id).toBe('res-explicit');
    expect(repo.findReservationIdForQuote).not.toHaveBeenCalled();
  });
});

describe('InvoicesService.issueSettledInvoice', () => {
  // Money already in hand: issuing it as ISSUED would put a settled booking into the
  // Finance cockpit's outstanding list and debtor ageing, which is untrue.
  it('raises the invoice and marks it paid in one go', async () => {
    const { svc, repo } = setup();
    // settleInvoice re-reads the row it is about to settle, so the fake has to know
    // about the invoice create() just made.
    repo.findById.mockResolvedValue({ id: 'inv1', status: 'ISSUED', total_amount: 114000 });
    const out = await svc.issueSettledInvoice(
      { quote_id: 'q1', kind: 'BALANCE', amount: 114000 } as any,
      { userId: 'u1' },
    );
    expect(repo.create).toHaveBeenCalled();
    expect(repo.settle).toHaveBeenCalledWith('inv1', null, expect.anything());
    expect(out.status).toBe('PAID');
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
