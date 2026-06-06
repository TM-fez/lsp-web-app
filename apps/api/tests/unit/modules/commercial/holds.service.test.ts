import { describe, it, expect, vi } from 'vitest';
import { HoldsService } from '../../../../src/modules/holds/holds.service.js';

function setup() {
  const repo = {
    findById: vi.fn(),
    findPaginated: vi.fn(),
    create: vi.fn(async (p: any) => ({ id: 'h1', status: 'HELD', ...p })),
    markStatus: vi.fn(async (id: string, status: string, reason: string | null) => ({ id, status, release_reason: reason })),
    incrementRetry: vi.fn(async (id: string) => ({ id, status: 'HELD', retry_count: 1 })),
    releaseExpired: vi.fn(async () => 2),
  } as any;
  const quotes = {
    getQuote: vi.fn().mockResolvedValue({ id: 'q1', status: 'ACTIVE', expires_at: new Date(Date.now() + 1e6) }),
    assertUsable: vi.fn(),
  } as any;
  return { svc: new HoldsService(repo, quotes), repo, quotes };
}

describe('HoldsService', () => {
  it('creates a hold from a usable quote', async () => {
    const { svc, repo, quotes } = setup();
    await svc.createHold({ quote_id: 'q1' } as any, { userId: 'u1' });
    expect(quotes.assertUsable).toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalled();
  });

  it('maps a unique violation to a 409 conflict', async () => {
    const { svc, repo } = setup();
    repo.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(svc.createHold({ quote_id: 'q1' } as any, { userId: 'u1' })).rejects.toThrow('already exists');
  });

  it('confirms only a HELD hold', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'h1', status: 'HELD' });
    await svc.confirm('h1', { userId: 'u1' });
    expect(repo.markStatus).toHaveBeenCalledWith('h1', 'CONFIRMED', null, { userId: 'u1' });
  });

  it('rejects confirming a non-HELD hold', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'h1', status: 'EXPIRED' });
    await expect(svc.confirm('h1', { userId: 'u1' })).rejects.toThrow('HELD');
  });

  it('records a retry on a HELD hold (retry-before-release)', async () => {
    const { svc, repo } = setup();
    repo.findById.mockResolvedValue({ id: 'h1', status: 'HELD' });
    await svc.recordRetry('h1', { userId: 'u1' });
    expect(repo.incrementRetry).toHaveBeenCalled();
  });

  it('sweeps expired holds', async () => {
    const { svc, repo } = setup();
    const n = await svc.releaseExpired();
    expect(n).toBe(2);
    expect(repo.releaseExpired).toHaveBeenCalled();
  });
});
