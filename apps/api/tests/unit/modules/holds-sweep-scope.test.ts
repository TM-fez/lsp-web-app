import { describe, it, expect, vi } from 'vitest';
import { HoldsService } from '../../../src/modules/holds/holds.service.js';

// The scheduler calls releaseExpired() with no arguments — that must stay the house-wide
// system sweep. Only the HTTP route passes a scope (round 4, NEW-13).
describe('HoldsService.releaseExpired', () => {
  it('passes no scope through for the scheduled sweep', async () => {
    const repo = { releaseExpired: vi.fn().mockResolvedValue(3) };
    const service = new HoldsService(repo as never, {} as never);
    expect(await service.releaseExpired()).toBe(3);
    expect(repo.releaseExpired).toHaveBeenCalledWith(undefined);
  });

  it('passes the caller’s scope through for a manual sweep', async () => {
    const repo = { releaseExpired: vi.fn().mockResolvedValue(1) };
    const service = new HoldsService(repo as never, {} as never);
    const scope = { propertyIds: ['p1'], meta: { userId: 'u1' } };
    await service.releaseExpired(scope);
    expect(repo.releaseExpired).toHaveBeenCalledWith(scope);
  });
});
