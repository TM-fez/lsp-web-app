import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

// (R6 #10) At 390 px only INVOICE and BILL TO fitted; amount, status, dates and the action
// were off-screen behind a sideways scroll. On a phone each invoice is now a card with
// everything a clerk needs to act on it.

const row = (over: Record<string, unknown>) => ({
  id: 'i', number: 'INV', hold_id: null, quote_id: null, reservation_id: null,
  kind: 'DEPOSIT', currency: 'BWP', subtotal_amount: 0, tax_rate_bps: 1400, tax_amount: 0,
  total_amount: 325000, status: 'ISSUED', receipt_file_id: null, refunded_amount: 0,
  created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
  bill_to_name: 'Acme Accounts', guest_name: 'Neo Kgosi', unit_code: 'G4',
  check_in_date: '2026-06-02', check_out_date: '2026-06-05', due_date: '2026-06-08', is_overdue: true, ...over,
});

vi.mock('./hooks', () => ({
  useInvoices: () => ({
    data: { data: [row({ id: 'i1', number: 'INV-PHONE-1' })], total: 1, page: 1, limit: 100,
      totals: { outstanding_amount: 325000, outstanding_count: 1, overdue_amount: 325000, overdue_count: 1 } },
    isLoading: false, isError: false, refetch: () => {},
  }),
  useSettleInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useRefundInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useActiveQuotes: () => ({ data: [], isLoading: false, isError: false }),
  useIssueInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { InvoicesPage } from './InvoicesPage';

describe('InvoicesPage on a phone', () => {
  const original = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'u', name: 'Admin', email: 'a@lsp.local', role: 'admin', permissions: ['invoices.update', 'invoices.refund'] } as never,
    });
  });
  afterEach(() => { window.matchMedia = original; });

  it('shows each invoice as a card — no sideways table — with amount, status, due date and the action', () => {
    render(<InvoicesPage />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const card = screen.getByTestId('invoice-card-i1');
    expect(within(card).getByText('INV-PHONE-1')).toBeInTheDocument();
    expect(within(card).getByText('BWP 3,250.00')).toBeInTheDocument();
    expect(within(card).getByText('OVERDUE')).toBeInTheDocument();
    expect(within(card).getByText(/Due/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Mark paid/ })).toBeInTheDocument();
  });
});
