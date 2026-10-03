import { describe, it, expect } from 'vitest';
import { renderInvoiceEmail, type InvoiceEmailData } from '../../../src/modules/invoices/invoices.email.js';
import type { CompanyDetails } from '../../../src/core/settings/appSettings.js';

// (P7) The invoice email carries the business details from Settings, and tells the guest
// where to pay only while money is actually owed.

const company: CompanyDetails = {
  name: 'Lifestyle <Apartments>', address: 'Plot 1, Village', phone: null, email: null, vat_number: 'P0123456',
  bank_name: 'FNB Botswana', bank_account_name: 'Lifestyle (Pty) Ltd', bank_account_number: '62000000000',
  bank_branch_code: '281467', footer: 'Reg. no. BW00001234',
};
const doc = (over: Partial<InvoiceEmailData>): InvoiceEmailData => ({
  number: 'INV-1', kind: 'DEPOSIT', status: 'ISSUED', currency: 'BWP', subtotal_amount: 100_000, tax_rate_bps: 0,
  tax_amount: 0, total_amount: 100_000, created_at: new Date('2026-10-01'), guest_name: 'Thato Moeng',
  bill_to_name: null, check_in_date: '2026-10-05', check_out_date: '2026-10-07', unit_code: 'J1', unit_name: 'J1',
  nights: 2, unit_type: 'STANDARD', ...over,
});

describe('renderInvoiceEmail', () => {
  it('prints the business name (escaped), VAT number and footer', () => {
    const { html } = renderInvoiceEmail(doc({}), company);
    expect(html).toContain('Lifestyle &lt;Apartments&gt;');
    expect(html).not.toContain('<Apartments>');
    expect(html).toContain('VAT P0123456');
    expect(html).toContain('Reg. no. BW00001234');
  });

  it('shows bank details on an invoice still owed, part-paid included', () => {
    for (const status of ['ISSUED', 'PARTIALLY_PAID']) {
      const { html } = renderInvoiceEmail(doc({ status }), company);
      expect(html).toContain('How to pay');
      expect(html).toContain('62000000000');
    }
  });

  it('never on a receipt, a void or a credit note', () => {
    for (const d of [doc({ status: 'PAID' }), doc({ status: 'VOID' }), doc({ kind: 'REFUND', status: 'REFUNDED' })]) {
      expect(renderInvoiceEmail(d, company).html).not.toContain('How to pay');
    }
  });
});
