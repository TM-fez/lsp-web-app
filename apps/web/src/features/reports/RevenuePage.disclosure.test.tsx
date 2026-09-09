import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * The disclosures the owner was promised in writing when revenue moved to the accrual
 * basis (2026-09-07). They were built for the P&L; this asserts they reach the
 * earned-vs-received view too, because that page quotes the same ledger and a caveat
 * that appears on one screen and not the other is worse than one that appears on
 * neither — it makes the uncaveated number look like the checked one.
 */
vi.mock('./hooks', () => ({
  useRevenue: () => ({
    data: {
      from: '2026-01-01',
      to: '2026-03-31',
      monthly: [
        { month: '2026-01', earned: 10_000_000, received: 4_000_000, difference: 6_000_000, reconstructed: 2_500_000 },
      ],
      totals: { earned: 10_000_000, received: 4_000_000, difference: 6_000_000, earned_tax: 1_200_000 },
      // A quarter of the figure is priced at today's rates, and three earning stays
      // have no ledger rows at all — the un-backfilled case.
      disclosure: { reconstructed: 2_500_000, reconstructed_pct: 25, unrecognised_stays: 3 },
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
}));

import { RevenuePage } from './RevenuePage';

describe('RevenuePage disclosures', () => {
  it('says how much of the earned figure is a reconstruction', () => {
    render(<RevenuePage />);
    expect(screen.getByText(/reconstruction/)).toBeInTheDocument();
    expect(screen.getByText(/P25,000\.00 of it \(25%\)/)).toBeInTheDocument();
  });

  // Without this line an un-backfilled deployment reads as a real revenue collapse
  // rather than as a job that has not been run.
  it('warns that earning stays are missing from the figure', () => {
    render(<RevenuePage />);
    expect(screen.getByText(/3 stays are missing from this figure/)).toBeInTheDocument();
    expect(screen.getByText(/understated/)).toBeInTheDocument();
  });
});
