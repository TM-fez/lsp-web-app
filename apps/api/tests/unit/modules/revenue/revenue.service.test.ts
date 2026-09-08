/**
 * G30 — RevenueService.reconcile, against fakes.
 *
 * The SQL lives in revenue-recognition.test.ts (real Postgres). What is under test
 * here is the decision each booking gets: recognise it, reconstruct it, skip it, or
 * withdraw it — and, above all, the difference between a stay that earned nothing and
 * one nobody can price.
 */
import { describe, it, expect, vi } from 'vitest';
import { RevenueService } from '../../../../src/modules/revenue/revenue.service.js';
import type { RevenueRepository } from '../../../../src/modules/revenue/revenue.repository.js';
import type { StayPricer } from '../../../../src/modules/revenue/revenue.service.js';

const BOOKING = {
  id: 'res-1',
  room_id: 'room-1',
  check_in_date: '2026-09-01',
  check_out_date: '2026-09-04', // 3 nights
  status: 'CONFIRMED',
  folio_total_amount: null as number | null,
  folio_currency: 'BWP',
  tax_rate_bps: 1400,
};

function setup(bookings = [BOOKING], live: unknown[] = []) {
  const replaceNights = vi.fn(async (input: { slices: unknown[] }) => ({
    written: input.slices.length,
    superseded: live.length,
  }));
  const repository = {
    findRecognisable: vi.fn(async () => bookings),
    findNoLongerEarning: vi.fn(async () => [] as string[]),
    liveNights: vi.fn(async () => live),
    replaceNights,
  } as unknown as RevenueRepository;
  return { repository, replaceNights };
}

const pricerReturning = (value: Record<string, unknown>): StayPricer => ({
  priceReservation: vi.fn(async () => value),
});

describe('a booking with an agreed total', () => {
  it('recognises it from the frozen folio, not from live pricing', async () => {
    const { repository, replaceNights } = setup([{ ...BOOKING, folio_total_amount: 300_000 }]);
    const pricer = pricerReturning({ priceable: true, total_amount: 999_999 });

    const result = await new RevenueService(repository, pricer).reconcile();

    expect(pricer.priceReservation).not.toHaveBeenCalled();
    expect(replaceNights.mock.calls[0]![0].totalSource).toBe('FOLIO');
    expect(result.amount_written).toBe(300_000);
    expect(result.reconstructed).toBe(0);
  });
});

describe('a booking with no agreed total', () => {
  it('reconstructs it when a pricer is wired, and says the figure is a reconstruction', async () => {
    const { repository, replaceNights } = setup();
    const result = await new RevenueService(
      repository,
      pricerReturning({ priceable: true, total_amount: 300_000 })
    ).reconcile();

    expect(replaceNights.mock.calls[0]![0].totalSource).toBe('PRICED');
    expect(result.reconstructed).toBe(1);
    expect(result.nights_reconstructed).toBe(3);
    expect(result.amount_reconstructed).toBe(300_000);
  });

  it('skips it entirely when no pricer is wired — the nightly sweep’s configuration', async () => {
    const { repository, replaceNights } = setup();
    const result = await new RevenueService(repository).reconcile();

    expect(replaceNights).not.toHaveBeenCalled();
    expect(result.unpriced).toBe(1);
  });

  /**
   * The bug the backfill's first real run exposed, and the reason "cannot price it"
   * and "it earned nothing" must stay different answers.
   *
   * A unit type with no active rate plan returns priceable:false. Reading that as a
   * total of zero recognised every night of every stay at zero — on the demo data,
   * 3,027 nights asserting that confirmed stays were free. getFolio() answers 0 for
   * the same case deliberately, but that is a display fallback so the drawer does not
   * blank; nobody reconciles a month from it. The ledger is the book of record and may
   * only state what it knows.
   */
  it('does not recognise a night at zero when the stay cannot be priced at all', async () => {
    const { repository, replaceNights } = setup();
    const result = await new RevenueService(
      repository,
      pricerReturning({ priceable: false, reason: 'No active rate plan for a DELUXE unit', nights: 3 })
    ).reconcile();

    expect(replaceNights).not.toHaveBeenCalled();
    expect(result.unpriced).toBe(1);
    expect(result.nights_written).toBe(0);
    expect(result.amount_written).toBe(0);
  });
});

describe('a dry run', () => {
  it('counts exactly what an apply would write, and writes nothing', async () => {
    const { repository, replaceNights } = setup([{ ...BOOKING, folio_total_amount: 300_000 }]);
    const service = new RevenueService(repository);

    const preview = await service.reconcile(undefined, { userId: null }, { dryRun: true });
    expect(replaceNights).not.toHaveBeenCalled();

    const applied = await service.reconcile();
    expect(replaceNights).toHaveBeenCalledOnce();

    // The preview is only worth showing an owner if it matches what follows.
    expect(preview.nights_written).toBe(applied.nights_written);
    expect(preview.amount_written).toBe(applied.amount_written);
    expect(preview.reservations_changed).toBe(applied.reservations_changed);
  });
});
