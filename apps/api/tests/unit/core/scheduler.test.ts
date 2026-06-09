import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSweep, startScheduler, stopScheduler } from '../../../src/core/scheduler.js';

describe('runSweep', () => {
  it('runs both sweeps and reports each count', async () => {
    const holds = { releaseExpired: vi.fn().mockResolvedValue(2) };
    const quotes = { expireStaleQuotes: vi.fn().mockResolvedValue(3) };

    const res = await runSweep(holds, quotes);

    expect(res).toEqual({ holdsReleased: 2, quotesExpired: 3 });
    expect(holds.releaseExpired).toHaveBeenCalledOnce();
    expect(quotes.expireStaleQuotes).toHaveBeenCalledOnce();
  });

  it('isolates failures — one sweep throwing does not cancel the other', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const holds = { releaseExpired: vi.fn().mockRejectedValue(new Error('db blip')) };
    const quotes = { expireStaleQuotes: vi.fn().mockResolvedValue(5) };

    const res = await runSweep(holds, quotes);

    expect(res).toEqual({ holdsReleased: 0, quotesExpired: 5 });
    expect(quotes.expireStaleQuotes).toHaveBeenCalledOnce();
  });
});

describe('startScheduler', () => {
  afterEach(() => stopScheduler());

  it('never starts under NODE_ENV=test so suites stay deterministic', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(startScheduler()).toBe(false);
  });
});
