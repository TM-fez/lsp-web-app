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

// ── Public enquiry capture (Phase 5 CRM) ─────────────────────────────────────
// A public "enquire / contact us" form that auto-files a lead (and a CRM contact
// when an email is given), so a website/WhatsApp enquiry never slips through.
export const PublicEnquirySourceEnum = z.enum(['WEBSITE', 'WHATSAPP', 'REFERRAL', 'OTHER']);

export const CreateEnquirySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().min(3).max(40).optional(),
  message: z.string().trim().min(1).max(500),
  source: PublicEnquirySourceEnum.default('WEBSITE'),
});
export type CreateEnquiryDTO = z.infer<typeof CreateEnquirySchema>;

export interface EnquiryConfirmation {
  reference: string; // a short code the guest can quote when we follow up
}

// ── Guest self check-in (Phase 5 / A6) ───────────────────────────────────────
// Keyed by the per-unit QR token. The GET is a read of stay context (no PII of the
// existing guest); the POST captures the guest's own details into the CRM contact.
export const GuestTokenSchema = z.object({ token: z.string().uuid('Invalid check-in code') });

export const SelfCheckinSchema = z.object({
  token: z.string().uuid('Invalid check-in code'),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(3).max(40).optional(),
});
export type SelfCheckinDTO = z.infer<typeof SelfCheckinSchema>;

/** What the in-apartment check-in page may show — the unit's context, never the
 * current guest's stored details (a random scanner must not read PII). */
export interface GuestCheckinInfo {
  property_name: string;
  unit_name: string;
  unit_code: string;
  has_stay: boolean;              // is there an active/imminent stay for this unit?
  check_out_date: string | null;  // YYYY-MM-DD, when has_stay
  already_checked_in: boolean;    // has this stay's guest already confirmed their details?
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
