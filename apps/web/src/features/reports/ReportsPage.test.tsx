import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const scope = vi.hoisted(() => ({ note: null as string | null }));

// Mock the data hook so the page renders a deterministic P&L (data inlined in the
// factory to avoid vi.mock hoisting issues).
vi.mock('./hooks', () => ({
  usePnl: () => ({
    data: {
      scope_note: scope.note,
      summary: {
        from: '2025-07-01', to: '2026-06-30',
        revenue: 345_941_550, maintenance_cost: 12_810_000, operating_expenses: 106_488_000,
        revenue_basis: 'ACCRUAL',
        // A fully-agreed, fully-recognised period: nothing to warn about, so the note
        // should say what basis it is on and stop there.
        disclosure: { reconstructed: 0, reconstructed_pct: 0, unrecognised_stays: 0 },
        total_cost: 119_298_000, net: 226_643_550, margin_pct: 65.5, vat_output: 42_500_000,
        reservations: 246, room_nights_booked: 2777, room_nights_available: 8760, occupancy_pct: 31.7,
      },
      monthly: [
        { month: '2026-04', revenue: 49_732_500, maintenance_cost: 2_650_000, operating_expenses: 11_000_000, net: 36_082_500 },
        { month: '2026-05', revenue: 47_882_850, maintenance_cost: 1_650_000, operating_expenses: 11_000_000, net: 35_232_850 },
        { month: '2026-06', revenue: 44_924_550, maintenance_cost: 510_000, operating_expenses: 11_000_000, net: 33_414_550 },
      ],
      by_property: [
        { property_id: 'p1', property_name: 'Village', revenue: 345_941_550, maintenance_cost: 12_810_000, operating_expenses: 106_488_000, net: 226_643_550, occupancy_pct: 31.7 },
      ],
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
  // H6 nudges: none in this fixture — the strip should simply not render.
  useNudges: () => ({ data: [] }),
}));

import { ReportsPage } from './ReportsPage';

describe('ReportsPage', () => {
  it('renders the P&L summary, chart and per-property table', () => {
    render(<ReportsPage />);
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByText('Net margin')).toBeInTheDocument();
    expect(screen.getByText('Revenue vs cost')).toBeInTheDocument();
    expect(screen.getByText('By property')).toBeInTheDocument();
    expect(screen.getByText('Village')).toBeInTheDocument();
    // 31.7% and P3.46M each appear twice (summary KPI + Village row) — that's correct.
    expect(screen.getAllByText('31.7%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('P3.46M').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('svg[role="img"]')).toBeTruthy();
  });

  // The revenue line is accrual since G30, so the same month reads differently from
  // the cash figure the owner saw before. A page that does not say which basis it is
  // showing is misleading, not merely terse.
  it('says which basis the revenue is on', () => {
    render(<ReportsPage />);
    expect(screen.getByText('Revenue earned')).toBeInTheDocument();
    expect(screen.getByText(/counted in the month the\s+nights were slept in/)).toBeInTheDocument();
  });

  it('stays quiet when there is nothing to disclose', () => {
    render(<ReportsPage />);
    expect(screen.queryByText(/reconstruction/)).not.toBeInTheDocument();
    expect(screen.queryByText(/understated/)).not.toBeInTheDocument();
  });

  // Round 4 / H10: a person who can see only some properties is told the company-level
  // costs are left out, so their profit is not mistaken for the whole company's.
  describe('scope note', () => {
    afterEach(() => { scope.note = null; });

    it('shows why company-level costs are missing when the server says so', () => {
      scope.note = 'Company-level costs (not tied to a property) are not included.';
      render(<ReportsPage />);
      expect(screen.getByRole('note')).toHaveTextContent('Company-level costs (not tied to a property) are not included.');
    });

    it('shows nothing extra to someone who can see every property', () => {
      render(<ReportsPage />);
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });
  });

  // (R6 item 20) A custom range typed back to front silently fell back to the preset, so
  // the figures on screen were not for the dates in the boxes. Say so.
  it('says when a custom range is back to front, and what it is showing instead', () => {
    render(<ReportsPage />);
    fireEvent.change(screen.getByLabelText('Custom range from'), { target: { value: '2026-09-30' } });
    fireEvent.change(screen.getByLabelText('Custom range to'), { target: { value: '2026-09-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The end date is before the start date');
  });
});
