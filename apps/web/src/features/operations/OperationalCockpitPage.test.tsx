import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock the data hook so the page renders a deterministic operations snapshot
// (data inlined in the factory to avoid vi.mock hoisting issues).
vi.mock('./hooks', () => ({
  useOperations: () => ({
    data: {
      window: { from: '2025-07-01', to: '2026-06-30', months: 12 },
      summary: { occupancy_pct: 42.5, room_nights_booked: 3100, room_nights_available: 7300, reservations: 240, revenue: 120_000_000, adr: 380_000, revpar: 164_000 },
      previous: { occupancy_pct: 38.0, room_nights_booked: 2700, room_nights_available: 7300, reservations: 210, revenue: 98_000_000, adr: 360_000, revpar: 137_000, from: '2024-07-01', to: '2025-06-30' },
      deltas: { occupancy_pts: 4.5, reservations_pct: 14.3, adr_pct: 5.6, revpar_pct: 19.7, revenue_pct: 22.4 },
      monthly: [
        { month: '2026-04', occupancy_pct: 40.0, room_nights_booked: 240, room_nights_available: 600, reservations: 20, revenue: 9_000_000, adr: 375_000 },
        { month: '2026-05', occupancy_pct: 45.0, room_nights_booked: 279, room_nights_available: 620, reservations: 22, revenue: 10_000_000, adr: 358_000 },
        { month: '2026-06', occupancy_pct: 50.0, room_nights_booked: 300, room_nights_available: 600, reservations: 25, revenue: 11_000_000, adr: 366_000 },
      ],
      by_property: [
        { property_id: 'p1', property_name: 'Village', occupancy_pct: 44.0, room_nights_booked: 2000, reservations: 150 },
        { property_id: 'p2', property_name: 'Riverside', occupancy_pct: 39.0, room_nights_booked: 1100, reservations: 90 },
      ],
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
}));

import { OperationalCockpitPage } from './OperationalCockpitPage';

describe('OperationalCockpitPage', () => {
  it('renders occupancy KPIs, YoY deltas, trend chart and per-property table', () => {
    render(<OperationalCockpitPage />);
    expect(screen.getByRole('heading', { name: 'Operational Cockpit' })).toBeInTheDocument();
    // "Occupancy" is both a KPI label and a table header — that's expected.
    expect(screen.getAllByText('Occupancy').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('RevPAR')).toBeInTheDocument();
    expect(screen.getByText('Occupancy trend')).toBeInTheDocument();
    expect(screen.getByText('By property')).toBeInTheDocument();
    // KPI value + a YoY points delta render.
    expect(screen.getByText('42.5%')).toBeInTheDocument();
    expect(screen.getByText('+4.5 pts')).toBeInTheDocument();
    // Debtor/occupancy properties render; Village occupancy shows once here + delta chart.
    expect(screen.getByText('Village')).toBeInTheDocument();
    expect(screen.getByText('Riverside')).toBeInTheDocument();
    expect(document.querySelector('svg[role="img"]')).toBeTruthy();
  });
});
