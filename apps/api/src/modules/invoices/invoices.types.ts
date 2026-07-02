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
