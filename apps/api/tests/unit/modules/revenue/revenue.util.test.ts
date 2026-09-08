/**
 * G30 — the nightly split (`revenue.util.ts`).
 *
 * The arithmetic the whole accrual ledger rests on: if these slices do not sum back
 * to the stay total, every P&L month built from them is wrong by a thebe or two and
 * nobody finds out until the owner reconciles a folio against a report.
 */
import { describe, it, expect } from 'vitest';
import { nightsOf, splitStayAcrossNights } from '../../../../src/modules/revenue/revenue.util.js';
import { splitInclusive } from '../../../../src/modules/quotes/quotes.util.js';

const VAT_BPS = 1400; // 14%, Botswana

describe('nightsOf — half-open, like every other range here', () => {
  it('excludes the check-out date', () => {
    expect(nightsOf('2026-09-28', '2026-10-01')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
  });

  // Same-day checkout/checkin is legal (invariant 4) precisely because the departing
  // guest does not earn the date the arriving guest does.
  it('earns nothing for a same-day arrival and departure', () => {
    expect(nightsOf('2026-09-28', '2026-09-28')).toEqual([]);
  });

  it('walks across a month boundary, and across a leap day', () => {
    expect(nightsOf('2028-02-27', '2028-03-02')).toEqual(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
  });
});

describe('splitStayAcrossNights — the slices sum back exactly', () => {
  it('splits a clean total evenly', () => {
    const slices = splitStayAcrossNights('2026-09-01', '2026-09-04', 300_00, VAT_BPS);
    expect(slices.map((s) => s.amount)).toEqual([100_00, 100_00, 100_00]);
  });

  // The case the naive `total / nights` gets wrong, and the reason money is integer
  // thebe: 1000/3 is not a number of thebe.
  it('gives the indivisible remainder to the earliest nights', () => {
    const slices = splitStayAcrossNights('2026-09-01', '2026-09-04', 1000, VAT_BPS);
    expect(slices.map((s) => s.amount)).toEqual([334, 333, 333]);
    expect(slices.reduce((n, s) => n + s.amount, 0)).toBe(1000);
  });

  it('earns nothing across no nights', () => {
    expect(splitStayAcrossNights('2026-09-01', '2026-09-01', 50_000, VAT_BPS)).toEqual([]);
  });

  // A whole month straddled: September's P&L must take exactly its own nights, and
  // the two months together must equal the stay.
  it('lands each night in its own month', () => {
    const slices = splitStayAcrossNights('2026-09-28', '2026-10-03', 100_000, VAT_BPS);
    const september = slices.filter((s) => s.stay_date.startsWith('2026-09'));
    const october = slices.filter((s) => s.stay_date.startsWith('2026-10'));

    expect(september).toHaveLength(3);
    expect(october).toHaveLength(2);
    expect(
      september.reduce((n, s) => n + s.amount, 0) + october.reduce((n, s) => n + s.amount, 0)
    ).toBe(100_000);
  });

  /**
   * The VAT figure that goes on a BURS return is the STAY's, not the sum of N
   * separately-rounded nightly ones. Spreading the tax independently is what keeps
   * those the same number.
   */
  it('sums to the stay’s own VAT, not to N roundings of it', () => {
    const total = 99_999;
    const slices = splitStayAcrossNights('2026-09-01', '2026-09-08', total, VAT_BPS);
    expect(slices.reduce((n, s) => n + s.tax_amount, 0)).toBe(splitInclusive(total, VAT_BPS).tax);
  });

  // Exhaustive rather than illustrative: the two sum identities and the table's
  // amounts-sane check must hold for every shape, not for the examples above.
  it('holds the sum and tax<=amount invariants across many shapes', () => {
    for (const nights of [1, 2, 3, 5, 7, 13, 28, 31, 60]) {
      for (const total of [0, 1, 2, 7, 999, 1000, 12_345, 99_999, 1_000_000]) {
        for (const bps of [0, 1400, 1500, 10_000]) {
          const checkOut = new Date(Date.parse('2026-09-01T00:00:00Z') + nights * 86_400_000)
            .toISOString()
            .slice(0, 10);
          const slices = splitStayAcrossNights('2026-09-01', checkOut, total, bps);

          expect(slices).toHaveLength(nights);
          expect(slices.reduce((n, s) => n + s.amount, 0)).toBe(total);
          expect(slices.reduce((n, s) => n + s.tax_amount, 0)).toBe(splitInclusive(total, bps).tax);

          for (const slice of slices) {
            expect(Number.isInteger(slice.amount)).toBe(true);
            expect(Number.isInteger(slice.tax_amount)).toBe(true);
            // revenue_recognition_amounts_sane, asserted before the database has to.
            expect(slice.tax_amount).toBeGreaterThanOrEqual(0);
            expect(slice.tax_amount).toBeLessThanOrEqual(slice.amount);
          }
        }
      }
    }
  });
});
