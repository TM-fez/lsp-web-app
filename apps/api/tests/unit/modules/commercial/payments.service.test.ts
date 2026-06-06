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
  const holds = { findById: vi.fn().mockResolvedValue({ id: 'h1', quote_id: 'q1', status: holdStatus }) } as any;
  const quotes = {
    getQuote: vi.fn().mockResolvedValue({ id: 'q1', deposit_amount: 57000, total_amount: 114000, currency: 'BWP' }),
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
