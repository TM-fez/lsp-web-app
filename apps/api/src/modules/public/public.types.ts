import { z } from 'zod';
import { UnitTypeEnum } from '../pricing/pricing.types.js';

// A public, guest-facing booking request. No auth — this is the front door onto
// the same booking engine staff use, so it is deliberately narrow and validated.
export const CreateBookingSchema = z
  .object({
    unit_type: UnitTypeEnum,
    check_in: z.coerce.date(),
    check_out: z.coerce.date(),
    guests: z.coerce.number().int().min(1).max(20).default(1),
    name: z.string().min(1).max(200),
    email: z.string().email().max(200),
    phone: z.string().min(3).max(40),
  })
  .refine((d) => d.check_in < d.check_out, {
    message: 'check_out must be after check_in',
    path: ['check_out'],
  });

export type CreateBookingDTO = z.infer<typeof CreateBookingSchema>;

// Manage-my-booking lookup: BOTH the confirmation code and the booking email must
// match — the code alone is guessable-ish (6 hex chars), the pair is not.
export const LookupBookingSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^(LSP-)?[0-9a-fA-F]{6}$/, 'That does not look like an LSP confirmation code'),
  email: z.string().trim().email().max(200),
});

export type LookupBookingDTO = z.infer<typeof LookupBookingSchema>;

/** What a guest may see about their own booking — no ids, no internals. */
export interface PublicBookingSummary {
  confirmation_code: string;
  guest_name: string;
  status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED';
  unit_name: string;
  unit_type: string;
  check_in: string; // YYYY-MM-DD
  check_out: string;
}

export interface PublicRequestMeta {
  ip?: string;
  requestId?: string;
}

/** One bookable layout shown on the public site (no PII, prices only). */
export interface StayUnitOption {
  unit_type: string;
  name: string;
  nightly_rate: number; // thebe
  deposit_pct: number;
  max_guests: number;
  min_nights: number;
  currency: string;
}
