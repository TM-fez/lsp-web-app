import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

const row = (over: Record<string, unknown>) => ({
  id: 'i', number: 'INV', hold_id: null, quote_id: null, reservation_id: null,
  kind: 'DEPOSIT', currency: 'BWP', subtotal_amount: 0, tax_rate_bps: 1400, tax_amount: 0,
  total_amount: 325000, status: 'ISSUED', receipt_file_id: null,
  created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
  bill_to_name: null, guest_name: null, unit_code: null,
  check_in_date: null, check_out_date: null, ...over,
});

vi.mock('./hooks', () => ({
  useInvoices: () => ({
    data: {
      data: [
        row({
          id: 'i1', number: 'INV-DEMO-00001', kind: 'DEPOSIT', status: 'ISSUED',
          // Corporate shape: the company is billed, the guest is someone else.
          bill_to_name: 'Acme Accounts', guest_name: 'Neo Kgosi', unit_code: 'G4',
          check_in_date: '2026-06-02', check_out_date: '2026-06-05',
        }),
        row({ id: 'i2', number: 'INV-DEMO-00002', kind: 'BALANCE', status: 'PAID', total_amount: 650000 }),
      ],
      total: 2, page: 1, limit: 100,
    },
    isLoading: false, isError: false, refetch: () => {},
  }),
  useSettleInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useRefundInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useActiveQuotes: () => ({ data: [], isLoading: false, isError: false }),
  useIssueInvoice: () => ({ mutate: vi.fn(), isPending: false }),
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

  // The list used to show an invoice number and an amount and nothing else, so you
  // could see that something was unpaid but never who had not paid it.
  it('shows who the invoice is for and which stay it covers', () => {
    render(<InvoicesPage />);
    expect(screen.getByText('Acme Accounts')).toBeInTheDocument();
    expect(screen.getByText('for Neo Kgosi')).toBeInTheDocument();  // billed elsewhere
    expect(screen.getByText('G4')).toBeInTheDocument();
  });

  // An invoice raised straight off a quote has no guest to resolve — it must render
  // as a dash rather than blowing up or showing "null".
  it('falls back to a dash when an invoice has no stay behind it', () => {
    render(<InvoicesPage />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
