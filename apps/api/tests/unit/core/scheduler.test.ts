import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSweep, startScheduler, stopScheduler } from '../../../src/core/scheduler.js';
import { logger } from '../../../src/core/logger.js';

describe('runSweep', () => {
  it('runs all sweeps and reports each count', async () => {
    const holds = { releaseExpired: vi.fn().mockResolvedValue(2) };
    const quotes = { expireStaleQuotes: vi.fn().mockResolvedValue(3) };
    const website = vi.fn().mockResolvedValue(1);

    const retention = vi.fn().mockResolvedValue({ refreshTokensPruned: 4, auditLogsPruned: 0 });
    const reminders = vi.fn().mockResolvedValue({ checkoutDue: 1, maintenanceStale: 2, maintenanceUnassigned: 3 });
    const channelSync = vi.fn().mockResolvedValue({ ran: true, upserted: 7, collisions: 1 });

    const res = await runSweep(holds, quotes, website, retention, reminders, channelSync);

    expect(res).toEqual({
      holdsReleased: 2,
      quotesExpired: 3,
      websiteBookingsExpired: 1,
      refreshTokensPruned: 4,
      auditLogsPruned: 0,
      remindersRaised: 6,
      channelBlocksUpserted: 7,
      channelCollisions: 1,
    });
    expect(holds.releaseExpired).toHaveBeenCalledOnce();
    expect(quotes.expireStaleQuotes).toHaveBeenCalledOnce();
    expect(website).toHaveBeenCalledOnce();
    expect(retention).toHaveBeenCalledOnce();
    expect(reminders).toHaveBeenCalledOnce();
    expect(channelSync).toHaveBeenCalledOnce();
  });

  it('isolates failures — one sweep throwing does not cancel the others', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const holds = { releaseExpired: vi.fn().mockRejectedValue(new Error('db blip')) };
    const quotes = { expireStaleQuotes: vi.fn().mockResolvedValue(5) };
    const website = vi.fn().mockRejectedValue(new Error('db blip'));

    const retention = vi.fn().mockRejectedValue(new Error('db blip'));
    const reminders = vi.fn().mockRejectedValue(new Error('db blip'));
    // Channel sync is the only sweep that reaches the network, so it is the likeliest
    // to fail (a timing-out OTA feed) and the one that most needs to fail alone.
    const channelSync = vi.fn().mockRejectedValue(new Error('feed timeout'));

    const res = await runSweep(holds, quotes, website, retention, reminders, channelSync);

    expect(res).toEqual({
      holdsReleased: 0,
      quotesExpired: 5,
      websiteBookingsExpired: 0,
      refreshTokensPruned: 0,
      auditLogsPruned: 0,
      remindersRaised: 0,
      channelBlocksUpserted: 0,
      channelCollisions: 0,
    });
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
