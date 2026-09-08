import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * The two warnings the owner was promised in writing when the accrual decision was
 * taken (G30). Its own file because the fixture has to differ from the clean one in
 * ReportsPage.test.tsx, and vi.mock is hoisted per file.
 */
vi.mock('./hooks', () => ({
  usePnl: () => ({
    data: {
      summary: {
        from: '2026-01-01', to: '2026-06-30',
        revenue_basis: 'ACCRUAL',
        revenue: 1_000_000,
        // A quarter of the figure was never agreed with a guest, and eleven stays are
        // missing from it altogether.
        disclosure: { reconstructed: 250_000, reconstructed_pct: 25, unrecognised_stays: 11 },
        maintenance_cost: 0, operating_expenses: 0, total_cost: 0, net: 1_000_000,
        margin_pct: 100, vat_output: 0,
        reservations: 4, room_nights_booked: 40, room_nights_available: 100, occupancy_pct: 40,
      },
      monthly: [],
      by_property: [],
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
  useNudges: () => ({ data: [] }),
}));

import { ReportsPage } from './ReportsPage';

describe('ReportsPage — accrual disclosure', () => {
  /**
   * Rate plans have no effective dating, so a stay with no agreed price was valued at
   * today's rates. Showing that total as though it were a record would misrepresent
   * money the house never actually charged.
   */
  it('says how much of the revenue is a reconstruction, in Pula and in percent', () => {
    render(<ReportsPage />);
    expect(screen.getByText(/reconstruction/)).toBeInTheDocument();
    expect(screen.getByText(/P2,500\.00/)).toBeInTheDocument();
    expect(screen.getByText(/25%/)).toBeInTheDocument();
  });

  /**
   * The difference between "a quiet month" and "the backfill has not been run". Without
   * this the second looks exactly like the first, and the owner reads a shortfall that
   * is not there.
   */
  it('warns that stays are missing entirely, and says the figure is understated', () => {
    render(<ReportsPage />);
    expect(screen.getByText(/11 stays are missing from this figure/)).toBeInTheDocument();
    expect(screen.getByText(/understated/)).toBeInTheDocument();
  });
});
