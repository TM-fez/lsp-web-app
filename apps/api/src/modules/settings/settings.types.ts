import { z } from 'zod';

// Free text the owner types; an empty field clears it (stored as NULL → built-in fallback).
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : v));

export const UpdateSettingsSchema = z.object({
  company_name: text(120),
  company_address: text(400),
  company_phone: text(40),
  company_email: z
    .union([z.literal(''), z.string().trim().email('Enter a valid email address').max(200)])
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : v)),
  vat_number: text(40),
  bank_name: text(80),
  bank_account_name: text(120),
  bank_account_number: text(40),
  bank_branch_code: text(20),
  invoice_footer: text(400),
  invoice_terms_days: z.number().int().min(0, 'Payment terms can’t be negative').max(90, 'Payment terms can be at most 90 days').nullable().optional(),
  website_hold_hours: z.number().int().min(1, 'Hold a booking for at least 1 hour').max(168, 'Hold a booking for at most 7 days (168 hours)').nullable().optional(),
});
export type UpdateSettingsDTO = z.infer<typeof UpdateSettingsSchema>;

export interface SettingsRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}
