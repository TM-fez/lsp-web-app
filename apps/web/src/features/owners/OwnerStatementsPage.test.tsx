import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock the data hook so the page renders a deterministic set of owners (data
// inlined in the factory to avoid vi.mock hoisting issues).
vi.mock('./hooks', () => ({
  useOwners: () => ({
    data: {
      from: '2026-03-01', to: '2026-03-31',
      totals: { landlords: 2, units: 3, revenue: 16_000_000, maintenance_cost: 2_500_000, net: 13_500_000 },
      owners: [
        {
          landlord_name: 'Kagiso Properties', landlord_phone: '+267 71 000 000',
          unit_count: 2, revenue: 10_000_000, nights: 40, room_nights_available: 62, occupancy_pct: 64.5,
          maintenance_cost: 2_500_000, net: 7_500_000,
          units: [
            { room_id: 'r1', room_code: 'A-101', room_name: 'Kagiso 1', property_id: 'p1', property_name: 'Village', revenue: 10_000_000, nights: 40, occupancy_pct: 64.5, maintenance_cost: 0, net: 10_000_000 },
            { room_id: 'r2', room_code: 'A-102', room_name: 'Kagiso 2', property_id: 'p1', property_name: 'Village', revenue: 0, nights: 0, occupancy_pct: 0, maintenance_cost: 2_500_000, net: -2_500_000 },
          ],
        },
        {
          landlord_name: 'Boitumelo Trust', landlord_phone: null,
          unit_count: 1, revenue: 6_000_000, nights: 15, room_nights_available: 31, occupancy_pct: 48.4,
          maintenance_cost: 1_000_000, net: 5_000_000,
          units: [
            { room_id: 'r3', room_code: 'B-201', room_name: 'Boitumelo 1', property_id: 'p1', property_name: 'Village', revenue: 6_000_000, nights: 15, occupancy_pct: 48.4, maintenance_cost: 1_000_000, net: 5_000_000 },
          ],
        },
      ],
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
}));

import { OwnerStatementsPage } from './OwnerStatementsPage';

describe('OwnerStatementsPage', () => {
  it('renders the portfolio totals and one row per landlord', () => {
    render(<OwnerStatementsPage />);
    expect(screen.getByRole('heading', { name: 'Owner statements' })).toBeInTheDocument();
    expect(screen.getByText('Landlords')).toBeInTheDocument();
    expect(screen.getByText('Owner-charged costs')).toBeInTheDocument();
    expect(screen.getByText('Kagiso Properties')).toBeInTheDocument();
    expect(screen.getByText('Boitumelo Trust')).toBeInTheDocument();
    // Kagiso net payout P75k appears in its row header.
    expect(screen.getAllByText('P75k').length).toBeGreaterThanOrEqual(1);
  });

  it('expands a landlord to reveal its per-unit lines', () => {
    render(<OwnerStatementsPage />);
    // Units are hidden until the owner is expanded.
    expect(screen.queryByText('A-101')).toBeNull();
    fireEvent.click(screen.getByText('Kagiso Properties'));
    expect(screen.getByText('A-101')).toBeInTheDocument();
    expect(screen.getByText('A-102')).toBeInTheDocument();
  });
});
