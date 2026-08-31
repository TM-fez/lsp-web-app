import { z } from 'zod';

export const InvoiceKindEnum = z.enum(['DEPOSIT', 'BALANCE', 'REFUND']);
export const InvoiceStatusEnum = z.enum(['ISSUED', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'VOID']);
export type InvoiceKind = z.infer<typeof InvoiceKindEnum>;
export type InvoiceStatus = z.infer<typeof InvoiceStatusEnum>;

export const IssueInvoiceSchema = z.object({
  quote_id: z.string().uuid(),
  hold_id: z.string().uuid().optional().nullable(),
  reservation_id: z.string().uuid().optional().nullable(),
  kind: z.enum(['DEPOSIT', 'BALANCE']),
  /**
   * Thebe. Overrides the deposit/balance slice of the quote when the amount is
   * already known — a payment taken at the desk is for whatever the guest actually
   * handed over, which is not necessarily the quote's 50% deposit. Omitted for the
   * ordinary deposit-then-balance flow, which keeps deriving both from the quote.
   */
  amount: z.number().int().positive().optional(),
});

export const SettleInvoiceSchema = z.object({
  receipt_file_id: z.string().uuid().optional().nullable(),
});

export const RefundInvoiceSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

export type IssueInvoiceDTO = z.infer<typeof IssueInvoiceSchema>;
export type SettleInvoiceDTO = z.infer<typeof SettleInvoiceSchema>;
export type RefundInvoiceDTO = z.infer<typeof RefundInvoiceSchema>;

export interface InvoiceFilters {
  // H5: restrict to one property via the entity's room -> building chain.
  property_id?: string;
  status?: InvoiceStatus;
  kind?: InvoiceKind;
  quote_id?: string;
  hold_id?: string;
}

export interface InvoiceRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}

/**
 * A list row: the invoice plus who it is for and which stay it covers.
 *
 * The list used to be `selectAll()` on invoices alone, which meant Accounts read
 * "INV-2026-A3F2 · BALANCE · P4,500 · ISSUED" with no way to tell whose money it
 * was — you could see that something was unpaid, never who had not paid. Every
 * field here is nullable because an invoice raised straight off a quote has no
 * guest to resolve: a quote prices a unit TYPE and dates, and carries no contact.
 */
export interface InvoiceListRow {
  bill_to_name: string | null;
  guest_name: string | null;
  unit_code: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
}
