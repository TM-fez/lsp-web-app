import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

const row = (over: Record<string, unknown>) => ({
  id: 'i', number: 'INV', hold_id: null, quote_id: null, reservation_id: null,
  kind: 'DEPOSIT', currency: 'BWP', subtotal_amount: 0, tax_rate_bps: 1400, tax_amount: 0,
  total_amount: 325000, status: 'ISSUED', receipt_file_id: null,
  created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z', ...over,
});

vi.mock('./hooks', () => ({
  useInvoices: () => ({
    data: {
      data: [
        row({ id: 'i1', number: 'INV-DEMO-00001', kind: 'DEPOSIT', status: 'ISSUED' }),
        row({ id: 'i2', number: 'INV-DEMO-00002', kind: 'BALANCE', status: 'PAID', total_amount: 650000 }),
      ],
      total: 2, page: 1, limit: 100,
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
  useSettleInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useRefundInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { InvoicesPage } from './InvoicesPage';

describe('InvoicesPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: 'u', name: 'Admin', email: 'a@lsp.local', role: 'admin', permissions: ['invoices.update', 'invoices.refund'] } as never,
    });
  });

  it('lists invoices with settle and refund actions', () => {
    render(<InvoicesPage />);
    expect(screen.getByRole('heading', { name: 'Invoices' })).toBeInTheDocument();
    expect(screen.getByText('INV-DEMO-00001')).toBeInTheDocument();
    expect(screen.getByText('Mark paid')).toBeInTheDocument();   // ISSUED → settle
    expect(screen.getByText('Refund')).toBeInTheDocument();       // PAID balance → refund
  });
});
