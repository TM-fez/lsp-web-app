import { z } from 'zod';

export const PaymentMethodEnum = z.enum(['CARD', 'MOBILE_MONEY', 'EFT', 'CASH', 'CORPORATE_CREDIT']);
export const PaymentStatusEnum = z.enum(['PENDING', 'RETRY', 'PAID', 'FAILED', 'EXPIRED']);
export const PaymentPurposeEnum = z.enum(['DEPOSIT', 'BALANCE']);
export const PaymentOutcomeEnum = z.enum(['SUCCESS', 'FAILURE']);

export type PaymentMethod = z.infer<typeof PaymentMethodEnum>;
export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;

export const CreatePaymentIntentSchema = z.object({
  hold_id: z.string().uuid(),
  method: PaymentMethodEnum,
  purpose: PaymentPurposeEnum.default('DEPOSIT'),
  // Defaults to the quote's deposit (or balance) when omitted.
  amount: z.number().int().positive().optional(),
  max_attempts: z.number().int().min(1).max(10).optional(),
});

export const AttemptPaymentSchema = z.object({
  outcome: PaymentOutcomeEnum,
  reference: z.string().max(200).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

export type CreatePaymentIntentDTO = z.infer<typeof CreatePaymentIntentSchema>;
export type AttemptPaymentDTO = z.infer<typeof AttemptPaymentSchema>;

export interface PaymentFilters {
  // H5: restrict to one property via the entity's room -> building chain.
  property_id?: string;
  status?: PaymentStatus;
  hold_id?: string;
}

/**
 * A list row: the intent plus the stay it was taken against.
 *
 * The list was `selectAll()` on payment_intents alone, which is unreadable — a row of
 * UUIDs, an amount and a status, with no way to tell whose payment failed. Nullable
 * throughout: an intent hangs off a HOLD, and a hold need not carry a reservation.
 */
export interface PaymentListRow {
  guest_name: string | null;
  unit_code: string | null;
  reservation_id: string | null;
}

export interface PaymentRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}
