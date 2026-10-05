import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// (R6 item 20) CBD owed P500 on an invoice raised today, and the cockpit's "Oldest debt"
// read "— · nothing outstanding" beside a P500 total. Zero days old is not zero owed.
vi.mock('./hooks', () => ({
  useReceivables: () => ({
    data: {
      as_of: '2026-10-05T09:00:00.000Z',
      summary: { total_receivable: 50_000, open_invoices: 1, oldest_days: 0, refunds_payable: 0, overdue_amount: 0, overdue_count: 0 },
      aging: [{ bucket: '0-30', amount: 50_000, count: 1 }],
      by_property: [{ property_id: 'pC', property_name: 'CBD', amount: 50_000, count: 1 }],
      invoices: [
        { id: 'i1', number: 'INV-1', kind: 'BALANCE', status: 'ISSUED', total_amount: 50_000, currency: 'BWP', bill_to_name: 'Kagiso', property_id: 'pC', property_name: 'CBD', created_at: '2026-10-05T08:00:00.000Z', days_outstanding: 0, due_date: '2026-10-12', days_overdue: 0 },
      ],
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
  useHeldOnCancelled: () => ({ data: { as_of: '', total_held: 0, count: 0, rows: [], note: '' }, isLoading: false, isError: false }),
}));

import { FinanceCockpitPage } from './FinanceCockpitPage';

describe('FinanceCockpitPage — debt raised today', () => {
  it('never says "nothing outstanding" while money is owed', () => {
    render(<FinanceCockpitPage />);
    expect(screen.queryByText('nothing outstanding')).not.toBeInTheDocument();
    expect(screen.getByText('raised today')).toBeInTheDocument();
  });
});
