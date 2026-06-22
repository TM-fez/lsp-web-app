import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('./hooks', () => ({
  usePnl: () => ({
    data: {
      summary: {
        from: '2025-07-01', to: '2026-06-30', revenue: 345_941_550, maintenance_cost: 12_810_000,
        operating_expenses: 106_488_000, total_cost: 119_298_000, net: 226_643_550, margin_pct: 65.5,
        vat_output: 42_500_000, reservations: 246, room_nights_booked: 2777, room_nights_available: 8760, occupancy_pct: 31.7,
      },
      monthly: [{ month: '2026-06', revenue: 44_924_550, maintenance_cost: 510_000, operating_expenses: 11_000_000, net: 33_414_550 }],
      by_property: [{ property_id: 'p1', property_name: 'Village', revenue: 345_941_550, maintenance_cost: 12_810_000, operating_expenses: 106_488_000, net: 226_643_550, occupancy_pct: 31.7 }],
    },
    isLoading: false, isError: false,
  }),
}));

import { ReportStatementPage } from './ReportStatementPage';

describe('ReportStatementPage', () => {
  it('renders a printable P&L statement', () => {
    render(<MemoryRouter initialEntries={['/reports/print?from=2025-07-01&to=2026-06-30']}><ReportStatementPage /></MemoryRouter>);
    expect(screen.getByText('Lifestyle Apartments')).toBeInTheDocument();
    expect(screen.getByText('Profit & Loss Statement')).toBeInTheDocument();
    expect(screen.getByText('VAT collected (output)')).toBeInTheDocument();
    expect(screen.getByText('Village')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print/ })).toBeInTheDocument();
  });
});
