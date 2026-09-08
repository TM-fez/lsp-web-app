/**
 * G30 — the recognition sweep as the scheduler drives it.
 *
 * Unit, with a fake service: what is under test is the GATING and the WINDOW, not the
 * SQL (revenue-recognition.test.ts covers that against real Postgres).
 */
import { describe, it, expect, vi } from 'vitest';
import { createRevenueSweeper, NO_RECOGNITION } from '../../../../src/modules/revenue/revenue.sweeper.js';
import { RevenueService } from '../../../../src/modules/revenue/revenue.service.js';
import { addDaysIso } from '../../../../src/modules/revenue/revenue.util.js';
import { todayInPropertyTZ } from '../../../../src/core/time.js';
import { env } from '../../../../src/config/env.js';

function fakeService() {
  const reconcile = vi.fn().mockResolvedValue({
    reservations_examined: 4,
    reservations_changed: 1,
    nights_written: 3,
    nights_superseded: 0,
    reconstructed: 0,
    unpriced: 0,
  });
  return { service: { reconcile } as unknown as RevenueService, reconcile };
}

describe('createRevenueSweeper — the daily gate', () => {
  it('runs on the first tick', async () => {
    const { service, reconcile } = fakeService();
    const sweep = createRevenueSweeper(undefined, 60_000, service);

    const result = await sweep();

    expect(reconcile).toHaveBeenCalledOnce();
    expect(result.nights_written).toBe(3);
  });

  /**
   * The scheduler ticks every 60 seconds. A night is earned on a calendar boundary,
   * so recognising on every tick would be 1,440 no-op passes over the ledger a day.
   */
  it('returns zeros without touching the ledger until the interval has passed', async () => {
    const { service, reconcile } = fakeService();
    const sweep = createRevenueSweeper(undefined, 60_000, service);

    await sweep();
    const second = await sweep();

    expect(reconcile).toHaveBeenCalledOnce();
    expect(second).toEqual(NO_RECOGNITION);
  });

  it('runs again once the interval has elapsed', async () => {
    const { service, reconcile } = fakeService();
    const sweep = createRevenueSweeper(undefined, 0, service);

    await sweep();
    await sweep();

    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});

describe('createRevenueSweeper — the window', () => {
  it('reconciles a rolling window around the property day', async () => {
    const { service, reconcile } = fakeService();
    const sweep = createRevenueSweeper(undefined, 60_000, service);

    await sweep();

    // The Gaborone day, not the server's (invariant 2): the window is a range of
    // calendar dates, so it is built from the property day and never from a timestamp.
    const today = todayInPropertyTZ();
    expect(reconcile).toHaveBeenCalledWith({
      from: addDaysIso(today, -env.REVENUE_LOOKBACK_DAYS),
      toExcl: addDaysIso(today, env.REVENUE_LOOKAHEAD_DAYS),
    });
  });

  it('bounds a window that is wide enough to hold a stay booked a year out', async () => {
    const { service, reconcile } = fakeService();
    await createRevenueSweeper(undefined, 60_000, service)();

    const { from, toExcl } = reconcile.mock.calls[0]![0]!;
    const spanDays = (Date.parse(`${toExcl}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

    expect(spanDays).toBeGreaterThan(365);
    expect(from < toExcl).toBe(true);
  });
});
