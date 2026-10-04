import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

const company = {
  name: 'Lifestyle Apartments', address: 'Plot 1, Village, Gaborone', phone: '+267 3900000', email: 'stay@lifestyle.bw',
  vat_number: 'P0123456', bank_name: 'FNB Botswana', bank_account_name: 'Lifestyle Apartments (Pty) Ltd',
  bank_account_number: '62000000000', bank_branch_code: '281467', footer: 'Reg. no. BW00001234',
};
const doc = {
  id: 'i1', number: 'INV-2026-ABC', kind: 'DEPOSIT', status: 'PAID', currency: 'BWP',
  subtotal_amount: 100_000, tax_rate_bps: 1400, tax_amount: 14_000, total_amount: 114_000,
  created_at: '2026-06-10T00:00:00Z',
  guest_name: 'Thato Moeng', guest_email: 'thato@example.com', guest_phone: '+267 71000000',
  check_in_date: '2026-06-12', check_out_date: '2026-06-15',
  unit_code: 'J1', unit_name: 'J1', nights: 3, unit_type: 'STANDARD', company,
};
const state = vi.hoisted(() => ({ status: 'PAID' }));

vi.mock('./hooks', () => ({
  useInvoiceDocument: () => ({ data: { ...doc, status: state.status }, isLoading: false, isError: false }),
  useSendInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { InvoiceDocumentPage } from './InvoiceDocumentPage';

const renderPage = () =>
  render(<MemoryRouter initialEntries={['/invoices/i1/print']}><InvoiceDocumentPage /></MemoryRouter>);

describe('InvoiceDocumentPage', () => {
  it('renders a printable invoice/receipt with the business details from Settings', () => {
    state.status = 'PAID';
    renderPage();
    expect(screen.getByText('Lifestyle Apartments')).toBeInTheDocument();
    expect(screen.getByText('Plot 1, Village, Gaborone')).toBeInTheDocument();
    expect(screen.getByText('VAT no. P0123456')).toBeInTheDocument();
    expect(screen.getByText('Reg. no. BW00001234')).toBeInTheDocument();
    expect(screen.getByText('INV-2026-ABC')).toBeInTheDocument();
    expect(screen.getByText('Thato Moeng')).toBeInTheDocument();
    expect(screen.getByText('Receipt')).toBeInTheDocument();          // PAID → titled Receipt
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print/ })).toBeInTheDocument();
    // A receipt is settled — no "how to pay" on it.
    expect(screen.queryByText('How to pay')).not.toBeInTheDocument();
  });

  it('tells the guest where to pay while money is owed, with the invoice number as reference', () => {
    state.status = 'ISSUED';
    renderPage();
    expect(screen.getByText('How to pay')).toBeInTheDocument();
    expect(screen.getByText('62000000000')).toBeInTheDocument();
    expect(screen.getByText('Reference')).toBeInTheDocument();
    expect(screen.getAllByText('INV-2026-ABC').length).toBe(2);
  });
});
