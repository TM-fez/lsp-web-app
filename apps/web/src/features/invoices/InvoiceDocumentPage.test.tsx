import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('./hooks', () => ({
  useInvoiceDocument: () => ({
    data: {
      id: 'i1', number: 'INV-2026-ABC', kind: 'DEPOSIT', status: 'PAID', currency: 'BWP',
      subtotal_amount: 100_000, tax_rate_bps: 1400, tax_amount: 14_000, total_amount: 114_000,
      created_at: '2026-06-10T00:00:00Z',
      guest_name: 'Thato Moeng', guest_email: 'thato@example.com', guest_phone: '+267 71000000',
      check_in_date: '2026-06-12', check_out_date: '2026-06-15',
      unit_code: 'J1', unit_name: 'J1', nights: 3, unit_type: 'STANDARD',
    },
    isLoading: false, isError: false,
  }),
  useSendInvoice: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { InvoiceDocumentPage } from './InvoiceDocumentPage';

describe('InvoiceDocumentPage', () => {
  it('renders a printable invoice/receipt', () => {
    render(<MemoryRouter initialEntries={['/invoices/i1/print']}><InvoiceDocumentPage /></MemoryRouter>);
    expect(screen.getByText('Lifestyle Apartments')).toBeInTheDocument();
    expect(screen.getByText('INV-2026-ABC')).toBeInTheDocument();
    expect(screen.getByText('Thato Moeng')).toBeInTheDocument();
    expect(screen.getByText('Receipt')).toBeInTheDocument();          // PAID → titled Receipt
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print/ })).toBeInTheDocument();
  });
});
