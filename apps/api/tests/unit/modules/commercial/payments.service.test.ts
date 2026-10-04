import { describe, it, expect, vi } from 'vitest';
import { PaymentsService } from '../../../../src/modules/payments/payments.service.js';

function setup(holdStatus = 'HELD') {
  const repo = {
    findById: vi.fn(),
    create: vi.fn(async (v: any) => ({ id: 'pi1', status: 'PENDING', attempts: 0, ...v })),
    settlePaid: vi.fn(async () => ({ id: 'pi1', status: 'PAID' })),
    recordRetry: vi.fn(async () => ({ id: 'pi1', status: 'RETRY' })),
    settleFailed: vi.fn(async () => ({ id: 'pi1', status: 'FAILED' })),
    listAttempts: vi.fn(),
    findPaginated: vi.fn(),
  } as any;
  const holds = { findById: vi.fn().mockResolvedValue({ id: 'h1', quote_id: 'q1', reservation_id: 'r1', status: holdStatus }) } as any;
  const quotes = {
    getQuote: vi.fn().mockResolvedValue({ id: 'q1', deposit_amount: 57000, total_amount: 114000, currency: 'BWP' }),
    prepareQuote: vi.fn().mockResolvedValue({ unit_type: 'STANDARD', total_amount: 114000, currency: 'BWP' }),
  } as any;
  return { svc: new PaymentsService(repo, holds, quotes), repo, holds, quotes };
}

describe('PaymentsService.createIntent', () => {
  it('defaults the amount to the quote deposit', async () => {
    const { svc, repo } = setup();
    await svc.createIntent({ hold_id: 'h1', method: 'MOBILE_MONEY', purpose: 'DEPOSIT' } as any, { userId: 'u1' });
    expect(repo.create.mock.calls[0][0].amount).toBe(57000);
  });

  it('defaults the balance amount when purpose is BALANCE', async () => {
    const { svc, repo } = setup();
    await svc.createIntent({ hold_id: 'h1', method: 'EFT', purpose: 'BALANCE' } as any, { userId: 'u1' });
    expect(repo.create.mock.calls[0][0].amount).toBe(57000); // 114000 - 57000
  });

  // A payment can never be bigger than what it pays for. (The binding check against what
  // the booking has already received happens under its lock — see stage1-money.test.ts.)
  it('rejects an explicit amount larger than the quote total', async () => {
    const { svc, repo } = setup();
    await expect(
      svc.createIntent({ hold_id: 'h1', method: 'CASH', purpose: 'BALANCE', amount: 114001 } as any, { userId: 'u1' })
    ).rejects.toThrow('more than the quote total (P1,140.00)');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('accepts an amount equal to the quote total', async () => {
    const { svc, repo } = setup();
    await svc.createIntent({ hold_id: 'h1', method: 'CASH', purpose: 'BALANCE', amount: 114000 } as any, { userId: 'u1' });
    expect(repo.create.mock.calls[0][0].amount).toBe(114000);
  });

  it('rejects taking payment on a non-HELD hold', async () => {
    const { svc } = setup('CONFIRMED');
    await expect(
      svc.createIntent({ hold_id: 'h1', method: 'CASH', purpose: 'DEPOSIT' } as any, { userId: 'u1' })
    ).rejects.toThrow('CONFIRMED');
  });
});

describe('PaymentsService.attempt — retry before release', () => {
  it('SUCCESS settles the intent and confirms the hold', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'pi1', hold_id: 'h1', status: 'PENDING', attempts: 0, max_attempts: 3, method: 'CARD' });
    const r = await svc.attempt('pi1', { outcome: 'SUCCESS' } as any, { userId: 'u1' });
    expect(repo.settlePaid).toHaveBeenCalled();
    expect(r.status).toBe('PAID');
  });

  it('threads the linked reservation id into settlePaid (closes the money loop)', async () => {
    const { svc, repo, holds } = setup();
    holds.findById.mockResolvedValue({ id: 'h1', quote_id: 'q1', status: 'HELD', reservation_id: 'res-42' });
    repo.findById.mockResolvedValue({ id: 'pi1', hold_id: 'h1', status: 'PENDING', attempts: 0, max_attempts: 3, method: 'CARD' });
    await svc.attempt('pi1', { outcome: 'SUCCESS' } as any, { userId: 'u1' });
    expect(repo.settlePaid.mock.calls[0][0]).toMatchObject({ holdId: 'h1', reservationId: 'res-42' });
  });

  // An intent created by settling an invoice has no hold and is already PAID; it must not be
  // re-attemptable, and must say so instead of dereferencing a null hold.
  it('refuses to re-attempt a payment recorded against an invoice (no hold)', async () => {
    const { svc, repo, holds } = setup();
    repo.findById.mockResolvedValue({ id: 'pi9', hold_id: null, invoice_id: 'inv1', status: 'RETRY', attempts: 0, max_attempts: 3, method: 'OTHER' });
    await expect(svc.attempt('pi9', { outcome: 'SUCCESS' } as any, { userId: 'u1' })).rejects.toThrow('recorded against an invoice');
    expect(holds.findById).not.toHaveBeenCalled();
    expect(repo.settlePaid).not.toHaveBeenCalled();
  });

  it('FAILURE with attempts remaining keeps the hold (RETRY)', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'pi1', hold_id: 'h1', status: 'PENDING', attempts: 0, max_attempts: 3, method: 'CARD' });
    await svc.attempt('pi1', { outcome: 'FAILURE' } as any, { userId: 'u1' });
    expect(repo.recordRetry).toHaveBeenCalled();
    expect(repo.settleFailed).not.toHaveBeenCalled();
  });

  it('FAILURE on the final attempt fails and releases the hold', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'pi1', hold_id: 'h1', status: 'RETRY', attempts: 2, max_attempts: 3, method: 'CARD' });
    await svc.attempt('pi1', { outcome: 'FAILURE' } as any, { userId: 'u1' });
    expect(repo.settleFailed).toHaveBeenCalled();
    expect(repo.recordRetry).not.toHaveBeenCalled();
  });

  it('rejects an attempt on an already-paid intent', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'pi1', hold_id: 'h1', status: 'PAID', attempts: 1, max_attempts: 3, method: 'CARD' });
    await expect(svc.attempt('pi1', { outcome: 'SUCCESS' } as any, { userId: 'u1' })).rejects.toThrow('cannot be retried');
  });

  it('rejects an attempt when the hold is no longer HELD', async () => {
    const { svc, repo, holds } = setup();
    repo.findById.mockResolvedValue({ id: 'pi1', hold_id: 'h1', status: 'PENDING', attempts: 0, max_attempts: 3, method: 'CARD' });
    holds.findById.mockResolvedValue({ id: 'h1', quote_id: 'q1', status: 'EXPIRED' });
    await expect(svc.attempt('pi1', { outcome: 'SUCCESS' } as any, { userId: 'u1' })).rejects.toThrow('EXPIRED');
  });
});

describe('PaymentsService.recordDeskPayment', () => {
  it('prices the stay BEFORE the transaction and hands the repository a ready-built quote', async () => {
    const { svc, repo, quotes } = setup();
    (repo as any).recordDeskPayment = vi.fn(async () => ({ id: 'pi1', status: 'PAID' }));
    const stay = { unit_type: 'STANDARD', check_in: new Date('2026-10-10'), check_out: new Date('2026-10-12'), guests: 1 };

    await svc.recordDeskPayment(
      { reservationId: 'res-1', roomId: 'room-1', stay: stay as any, pricedTotal: 100_800, amount: 50_000, method: 'CASH', reference: 'R1' },
      { userId: 'u1', requestId: 'req-1' },
    );

    // Reads happen here, on their own connections; the locked section only writes.
    expect(quotes.prepareQuote).toHaveBeenCalledWith(stay, expect.objectContaining({ userId: 'u1' }));
    expect((repo as any).recordDeskPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 'res-1',
        roomId: 'room-1',
        quote: expect.objectContaining({ total_amount: 114000 }),
        // The booking's own priced total (discount applied), NOT the quote's rack-rate total.
        pricedTotal: 100_800,
        amount: 50_000,
        method: 'CASH',
        reference: 'R1',
        note: null,
        holdTtlMs: expect.any(Number),
      }),
      expect.objectContaining({ userId: 'u1' }),
    );
  });

  it('leaves the amount undefined so the repository can take the live balance under the lock', async () => {
    const { svc, repo } = setup();
    (repo as any).recordDeskPayment = vi.fn(async () => ({ id: 'pi1' }));
    await svc.recordDeskPayment(
      { reservationId: 'res-1', roomId: 'room-1', stay: {} as any, pricedTotal: 1, method: 'EFT' },
      { userId: 'u1' },
    );
    expect((repo as any).recordDeskPayment.mock.calls[0][0].amount).toBeUndefined();
  });
});
