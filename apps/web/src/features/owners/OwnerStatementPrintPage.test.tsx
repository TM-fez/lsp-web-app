import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('./hooks', () => ({
  useOwners: () => ({
    data: {
      from: '2026-03-01', to: '2026-03-31',
      totals: { landlords: 1, units: 2, revenue: 10_000_000, maintenance_cost: 2_500_000, net: 7_500_000 },
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
      ],
    },
    isLoading: false, isError: false,
  }),
}));

import { OwnerStatementPrintPage } from './OwnerStatementPrintPage';

describe('OwnerStatementPrintPage', () => {
  it('renders a printable per-landlord statement', () => {
    render(
      <MemoryRouter initialEntries={['/owners/print?from=2026-03-01&to=2026-03-31&landlord=Kagiso%20Properties']}>
        <OwnerStatementPrintPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Lifestyle Apartments')).toBeInTheDocument();
    expect(screen.getByText('Owner Statement')).toBeInTheDocument();
    expect(screen.getByText('Payable to')).toBeInTheDocument();
    // The landlord appears in the header block.
    expect(screen.getByText('Kagiso Properties')).toBeInTheDocument();
    // Per-unit lines are listed.
    expect(screen.getByText('A-101')).toBeInTheDocument();
    expect(screen.getByText('A-102')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print/ })).toBeInTheDocument();
  });

  it('shows a friendly error when the landlord isn’t in the window', () => {
    render(
      <MemoryRouter initialEntries={['/owners/print?from=2026-03-01&to=2026-03-31&landlord=Nobody']}>
        <OwnerStatementPrintPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Couldn’t load statement')).toBeInTheDocument();
  });
});
