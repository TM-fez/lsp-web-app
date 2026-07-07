import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock the data hook so the page renders a deterministic receivables snapshot
// (data inlined in the factory to avoid vi.mock hoisting issues).
vi.mock('./hooks', () => ({
  useReceivables: () => ({
    data: {
      as_of: '2026-07-07T09:00:00.000Z',
      summary: { total_receivable: 35_000_000, open_invoices: 3, oldest_days: 100, refunds_payable: 2_000_000 },
      aging: [
        { bucket: '0-30', amount: 10_000_000, count: 1 },
        { bucket: '31-60', amount: 5_000_000, count: 1 },
        { bucket: '61-90', amount: 0, count: 0 },
        { bucket: '90+', amount: 20_000_000, count: 1 },
      ],
      by_property: [
        { property_id: 'pB', property_name: 'Riverside', amount: 20_000_000, count: 1 },
        { property_id: 'pA', property_name: 'Village', amount: 15_000_000, count: 2 },
      ],
      invoices: [
        { id: 'i1', number: 'INV-900', kind: 'BALANCE', status: 'ISSUED', total_amount: 20_000_000, currency: 'BWP', bill_to_name: 'Neo Guest', property_id: 'pB', property_name: 'Riverside', created_at: '2026-03-29T00:00:00.000Z', days_outstanding: 100 },
        { id: 'i2', number: 'INV-910', kind: 'BALANCE', status: 'ISSUED', total_amount: 10_000_000, currency: 'BWP', bill_to_name: 'Acme Accounts', property_id: 'pA', property_name: 'Village', created_at: '2026-06-27T00:00:00.000Z', days_outstanding: 10 },
      ],
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
}));

import { FinanceCockpitPage } from './FinanceCockpitPage';

describe('FinanceCockpitPage', () => {
  it('renders the receivables summary, ageing and tables', () => {
    render(<FinanceCockpitPage />);
    expect(screen.getByRole('heading', { name: 'Financial Cockpit' })).toBeInTheDocument();
    expect(screen.getByText('Total outstanding')).toBeInTheDocument();
    expect(screen.getByText('Refunds payable')).toBeInTheDocument();
    expect(screen.getByText('Ageing')).toBeInTheDocument();
    expect(screen.getByText('By property')).toBeInTheDocument();
    expect(screen.getByText('Outstanding invoices')).toBeInTheDocument();
    // Debtor properties + the oldest invoice's bill-to all render. Riverside
    // shows twice (by-property row + the invoice's property column) — that's correct.
    expect(screen.getAllByText('Riverside').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('INV-900')).toBeInTheDocument();
    expect(screen.getByText('Neo Guest')).toBeInTheDocument();
    // P350k total appears as a KPI (compact form).
    expect(screen.getAllByText('P350k').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('svg[role="img"]')).toBeTruthy();
  });
});
