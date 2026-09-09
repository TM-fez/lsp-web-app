import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// A period where the house earned more than it collected — the ordinary shape of an
// accrual book, and the one this page exists to make visible. Data is inlined in the
// factory to avoid vi.mock hoisting issues.
vi.mock('./hooks', () => ({
  useRevenue: () => ({
    data: {
      from: '2026-04-01',
      to: '2026-06-30',
      monthly: [
        { month: '2026-04', earned: 49_732_500, received: 49_732_500, difference: 0, reconstructed: 0 },
        { month: '2026-05', earned: 47_882_850, received: 30_000_000, difference: 17_882_850, reconstructed: 0 },
        // Collected ahead of the stay: a deposit on nights not yet slept in. Negative
        // is not an error and must not be shown as one.
        { month: '2026-06', earned: 44_924_550, received: 50_000_000, difference: -5_075_450, reconstructed: 0 },
      ],
      totals: { earned: 142_539_900, received: 129_732_500, difference: 12_807_400, earned_tax: 17_500_000 },
      disclosure: { reconstructed: 0, reconstructed_pct: 0, unrecognised_stays: 0 },
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
}));

import { RevenuePage } from './RevenuePage';

describe('RevenuePage', () => {
  it('renders the totals, chart and month-by-month reconciliation', () => {
    render(<RevenuePage />);
    expect(screen.getByRole('heading', { name: 'Earned vs received' })).toBeInTheDocument();
    // Each label appears three times — KPI tile, chart legend, table column — and
    // that repetition is deliberate, so assert presence rather than uniqueness.
    expect(screen.getAllByText('Earned').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Received').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('The reconciliation')).toBeInTheDocument();
    expect(screen.getByText('2026-05')).toBeInTheDocument();
    expect(document.querySelector('svg[role="img"]')).toBeTruthy();
  });

  // The sign is the whole meaning of the column. Earned-ahead-of-cash is a receivable;
  // cash-ahead-of-earned is a deposit. Labelling the tile "Still owed" either way would
  // report money the house does not have coming.
  it('labels a positive difference as money still owed', () => {
    render(<RevenuePage />);
    expect(screen.getByText('Still owed')).toBeInTheDocument();
    expect(screen.getByText('earned, not yet collected')).toBeInTheDocument();
    expect(screen.queryByText('Paid in advance')).not.toBeInTheDocument();
  });

  it('explains what the gap between the columns means', () => {
    render(<RevenuePage />);
    expect(screen.getByText(/owed for nights it has already provided/)).toBeInTheDocument();
  });

  // A clean, fully-agreed, fully-backfilled period has nothing to warn about — the
  // absence of the warnings is itself the signal, so they must not render unprompted.
  it('shows no accrual warnings when nothing is reconstructed or missing', () => {
    render(<RevenuePage />);
    expect(screen.queryByText(/reconstruction/)).not.toBeInTheDocument();
    expect(screen.queryByText(/understated/)).not.toBeInTheDocument();
  });
});
