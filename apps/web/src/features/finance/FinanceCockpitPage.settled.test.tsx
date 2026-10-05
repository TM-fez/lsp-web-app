import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// (R5 retest) A property with nothing outstanding but a cancelled booking still holding
// P100: "All settled" is true of receivables, and the held money must still show.
vi.mock('./hooks', () => ({
  useReceivables: () => ({
    data: {
      as_of: '2026-10-04T09:00:00.000Z',
      summary: { total_receivable: 0, open_invoices: 0, oldest_days: 0, refunds_payable: 0, overdue_amount: 0, overdue_count: 0 },
      aging: [],
      by_property: [],
      invoices: [],
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
  useHeldOnCancelled: () => ({
    data: {
      as_of: '', count: 1, total_held: 10_000, note: 'Nothing is refunded automatically.',
      rows: [{ reservation_id: 'r1', guest_name: 'Kagiso', room_code: 'CBD-1', check_in_date: '2026-10-01', check_out_date: '2026-10-03', status: 'CANCELLED', received: 10_000 }],
    },
    isLoading: false, isError: false,
  }),
}));

import { FinanceCockpitPage } from './FinanceCockpitPage';

describe('FinanceCockpitPage with nothing outstanding', () => {
  it('still shows money held on a cancelled booking', () => {
    render(<FinanceCockpitPage />);
    expect(screen.getByText('All settled')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cancelled with money held' })).toBeInTheDocument();
    expect(screen.getByText('Kagiso')).toBeInTheDocument();
  });
});
