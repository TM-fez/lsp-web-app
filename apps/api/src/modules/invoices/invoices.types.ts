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
  /**
   * How the money arrived. Optional because the Invoices screen has never asked; when
   * omitted the payment is recorded as OTHER ("method not recorded") rather than a
   * guessed CASH — see migration 070.
   */
  method: z.enum(['CARD', 'MOBILE_MONEY', 'EFT', 'CASH', 'CORPORATE_CREDIT', 'OTHER']).optional(),
});

export const RefundInvoiceSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

export type IssueInvoiceDTO = z.infer<typeof IssueInvoiceSchema>;
export type SettleInvoiceDTO = z.infer<typeof SettleInvoiceSchema>;
export type RefundInvoiceDTO = z.infer<typeof RefundInvoiceSchema>;

/**
 * GET /invoices query string. Parsed with Zod so a malformed id or date is a clean 400
 * instead of a Postgres error reaching the client (and so an unknown value for a filter
 * is rejected rather than silently dropped).
 */
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31');
const queryBool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const InvoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: InvoiceStatusEnum.optional(),
  kind: InvoiceKindEnum.optional(),
  quote_id: z.string().uuid().optional(),
  hold_id: z.string().uuid().optional(),
  property_id: z.string().uuid().optional(),
  /** Open receivables only: ISSUED + PARTIALLY_PAID, refunds excluded. */
  outstanding: queryBool.optional(),
  /** Open AND past their due date (Africa/Gaborone today). */
  overdue: queryBool.optional(),
  /** (Re-test 2026-10-04) Open and NOT yet overdue — money still coming in on time. */
  incoming: queryBool.optional(),
  /** Invoice number, guest or bill-to name, unit code or name. */
  search: z.string().trim().min(1).max(100).optional(),
  /** Issue-date range, inclusive, Africa/Gaborone days. */
  from: isoDay.optional(),
  to: isoDay.optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, {
  message: 'The "from" date must not be after the "to" date',
  path: ['to'],
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

export interface InvoiceFilters {
  // H5: restrict to one property (see core/scope/invoiceProperty.ts).
  property_id?: string;
  status?: InvoiceStatus;
  kind?: InvoiceKind;
  quote_id?: string;
  hold_id?: string;
  outstanding?: boolean;
  overdue?: boolean;
  incoming?: boolean;
  search?: string;
  from?: string;
  to?: string;
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
  /** YYYY-MM-DD (Africa/Gaborone); null for refund credit notes. */
  due_date: string | null;
  /** Open and past due — computed against Gaborone today, never against the browser. */
  is_overdue: boolean;
  bill_to_name: string | null;
  guest_name: string | null;
  unit_code: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
}

/** What is owed in the current view, whichever status tab is open. Thebe. */
export interface InvoiceListTotals {
  outstanding_amount: number;
  outstanding_count: number;
  overdue_amount: number;
  overdue_count: number;
  /**
   * Plain-English statement of what these four numbers cover, so a "Paid" tab that shows
   * outstanding money is never mistaken for a bug. Sent with every list response.
   */
  scope: string;
}

export interface InvoiceListResult {
  data: Array<import('../../db/types.js').InvoiceRow & InvoiceListRow>;
  total: number;
  page: number;
  limit: number;
  totals: InvoiceListTotals;
}
