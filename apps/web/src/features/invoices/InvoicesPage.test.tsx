import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/auth';

const row = (over: Record<string, unknown>) => ({
  id: 'i', number: 'INV', hold_id: null, quote_id: null, reservation_id: null,
  kind: 'DEPOSIT', currency: 'BWP', subtotal_amount: 0, tax_rate_bps: 1400, tax_amount: 0,
  total_amount: 325000, status: 'ISSUED', receipt_file_id: null,
  created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
  bill_to_name: null, guest_name: null, unit_code: null,
  check_in_date: null, check_out_date: null, due_date: '2026-06-08', is_overdue: false, ...over,
});

// Every call's params, so a test can assert what the page asked the server for.
const useInvoicesSpy = vi.fn();

vi.mock('./hooks', () => ({
  useInvoices: (params: unknown) => {
    useInvoicesSpy(params);
    return {
    data: {
      data: [
        row({
          id: 'i1', number: 'INV-DEMO-00001', kind: 'DEPOSIT', status: 'ISSUED',
          // Corporate shape: the company is billed, the guest is someone else.
          bill_to_name: 'Acme Accounts', guest_name: 'Neo Kgosi', unit_code: 'G4',
          check_in_date: '2026-06-02', check_out_date: '2026-06-05', is_overdue: true,
        }),
        row({ id: 'i2', number: 'INV-DEMO-00002', kind: 'BALANCE', status: 'PAID', total_amount: 650000 }),
      ],
      total: 2, page: 1, limit: 100,
      totals: { outstanding_amount: 325000, outstanding_count: 1, overdue_amount: 325000, overdue_count: 1 },
    },
    isLoading: false, isError: false, refetch: () => {},
    };
  },
  useSettleInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useRefundInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useActiveQuotes: () => ({ data: [], isLoading: false, isError: false }),
  useIssueInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { InvoicesPage } from './InvoicesPage';

describe('InvoicesPage', () => {
  beforeEach(() => {
    useInvoicesSpy.mockClear();
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

  const lastParams = () => useInvoicesSpy.mock.calls.at(-1)![0] as Record<string, unknown>;

  // "Unpaid" used to filter on the single status ISSUED, which hid every part-paid balance.
  it('asks the server for open receivables on the Unpaid tab, not for one status', () => {
    render(<InvoicesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Unpaid' }));
    expect(lastParams()).toMatchObject({ outstanding: true, status: undefined });
  });

  it('asks for overdue invoices on the Overdue tab', () => {
    render(<InvoicesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Overdue' }));
    expect(lastParams()).toMatchObject({ overdue: true });
  });

  it('sends the search text and date range to the server', async () => {
    render(<InvoicesPage />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Neo' } });
    fireEvent.change(screen.getByLabelText('Issued from'), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText('to'), { target: { value: '2026-06-30' } });
    await waitFor(() => expect(lastParams()).toMatchObject({ search: 'Neo', from: '2026-06-01', to: '2026-06-30' }));
  });

  it('does not send a backwards date range, and says why', () => {
    render(<InvoicesPage />);
    fireEvent.change(screen.getByLabelText('Issued from'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('to'), { target: { value: '2026-06-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/start date is after the end date/i);
    expect(lastParams().from).toBeUndefined();
    expect(lastParams().to).toBeUndefined();
  });

  it('shows what is owed in the view, flags overdue invoices and their due date', () => {
    render(<InvoicesPage />);
    expect(screen.getByText(/Unpaid in this view/)).toBeInTheDocument();
    expect(screen.getAllByText('OVERDUE').length).toBe(1);
    expect(screen.getAllByText('08 Jun 2026').length).toBeGreaterThan(0);
  });
});
