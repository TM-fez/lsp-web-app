/**
 * G30 — the two revenue bases, and the reconciliation between them.
 *
 * Unit, against a fake repository: what is under test is which basis becomes
 * `revenue`, what gets disclosed alongside it, and how the earned/received rows are
 * assembled. The SQL has its own suite against real Postgres.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReportsService } from '../../../../src/modules/reports/reports.service.js';
import type { ReportsRepository } from '../../../../src/modules/reports/reports.repository.js';

const WINDOW = { from: '2026-09-01', to: '2026-10-31', accessiblePropertyIds: null };

function setup(over: Partial<Record<string, unknown>> = {}) {
  const repo = {
    // Cash: the guest paid in October for a September stay.
    revenueByMonth: vi.fn(async () => [{ month: '2026-10', amount: 100_000 }]),
    revenueByProperty: vi.fn(async () => [{ property_id: 'p1', property_name: 'Village', amount: 100_000 }]),
    // Accrual: the night was slept in September.
    earnedByMonth: vi.fn(async () => [
      { month: '2026-09', amount: 100_000, tax: 12_280, reconstructed: 25_000 },
    ]),
    earnedByProperty: vi.fn(async () => [
      { property_id: 'p1', property_name: 'Village', amount: 100_000, tax: 12_280, reconstructed: 25_000 },
    ]),
    unrecognisedStays: vi.fn(async () => 0),
    maintenanceByMonth: vi.fn(async () => []),
    maintenanceByProperty: vi.fn(async () => []),
    opexByMonth: vi.fn(async () => []),
    opexByProperty: vi.fn(async () => []),
    occupancyByProperty: vi.fn(async () => []),
    roomCountByProperty: vi.fn(async () => []),
    vatOutput: vi.fn(async () => 0),
    ...over,
  } as unknown as ReportsRepository;
  return { service: new ReportsService(repo), repo };
}

describe('which clock the P&L is on', () => {
  it('defaults to accrual — the owner’s decision, not an opt-in', async () => {
    const { service } = setup();
    const report = await service.getReports(WINDOW);

    expect(report.summary.revenue_basis).toBe('ACCRUAL');
    expect(report.summary.revenue).toBe(100_000);
    // September earned it, so September is where it shows — even though the cash
    // landed in October.
    expect(report.monthly.find((m) => m.month === '2026-09')?.revenue).toBe(100_000);
    expect(report.monthly.find((m) => m.month === '2026-10')?.revenue).toBe(0);
  });

  it('reports the cash basis when asked, and says so', async () => {
    const { service } = setup();
    const report = await service.getReports({ ...WINDOW, basis: 'CASH' });

    expect(report.summary.revenue_basis).toBe('CASH');
    expect(report.monthly.find((m) => m.month === '2026-10')?.revenue).toBe(100_000);
    expect(report.monthly.find((m) => m.month === '2026-09')?.revenue).toBe(0);
  });

  it('discloses the reconstructed share on the accrual basis', async () => {
    const { service } = setup();
    const { summary } = await service.getReports(WINDOW);

    expect(summary.disclosure).toEqual({
      reconstructed: 25_000,
      reconstructed_pct: 25,
      unrecognised_stays: 0,
    });
  });

  // Nothing about cash is reconstructed, and nothing is missing from it that a
  // backfill would supply — an empty disclosure there would invite a false reading.
  it('discloses nothing on the cash basis', async () => {
    const { service } = setup();
    const { summary } = await service.getReports({ ...WINDOW, basis: 'CASH' });
    expect(summary.disclosure).toBeUndefined();
  });

  /**
   * The difference between "September was quiet" and "September has not been
   * recognised yet". An un-backfilled deployment reads as a catastrophic revenue
   * drop that looks exactly like a real one, so the zero has to arrive explained.
   */
  it('says how many earning stays are missing from the figure', async () => {
    const { service } = setup({
      earnedByMonth: vi.fn(async () => []),
      earnedByProperty: vi.fn(async () => []),
      unrecognisedStays: vi.fn(async () => 269),
    });
    const { summary } = await service.getReports(WINDOW);

    expect(summary.revenue).toBe(0);
    expect(summary.disclosure?.unrecognised_stays).toBe(269);
  });
});

describe('earned vs received', () => {
  it('shows the gap that pay-later creates, month by month', async () => {
    const { service } = setup();
    const rec = await service.getRevenue(WINDOW);

    const september = rec.monthly.find((m) => m.month === '2026-09')!;
    const october = rec.monthly.find((m) => m.month === '2026-10')!;

    // September provided the nights and collected nothing; October collected for them.
    expect(september).toMatchObject({ earned: 100_000, received: 0, difference: 100_000 });
    expect(october).toMatchObject({ earned: 0, received: 100_000, difference: -100_000 });

    // Over a window containing both, the two sides settle.
    expect(rec.totals).toMatchObject({ earned: 100_000, received: 100_000, difference: 0 });
  });

  it('carries the accrual VAT total, the counterpart of the P&L’s cash vat_output', async () => {
    const { service } = setup();
    expect((await service.getRevenue(WINDOW)).totals.earned_tax).toBe(12_280);
  });

  // A missing month reads as an outage; an explicit zero reads as a quiet month,
  // which is what it is.
  it('emits a zero row for a month with no activity at all', async () => {
    const { service } = setup({
      revenueByMonth: vi.fn(async () => []),
      earnedByMonth: vi.fn(async () => []),
    });
    const rec = await service.getRevenue(WINDOW);

    expect(rec.monthly.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(rec.monthly.every((m) => m.earned === 0 && m.received === 0)).toBe(true);
  });
});
