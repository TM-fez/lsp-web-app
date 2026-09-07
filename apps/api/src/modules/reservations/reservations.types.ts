import { z } from 'zod';
import type { ReservationRow } from '../../db/types.js';
import type { CRMRequestMeta, PaginatedResult, PaginationOptions } from '../crm/crm.types.js';

export const ReservationStatusEnum = z.enum([
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  // OTA-imported calendar block (Booking.com). Set ONLY by channel sync, never by a
  // user — intentionally absent from UserInputReservationStatusEnum below, and rejected
  // by UpdateReservationSchema.
  'BLOCKED',
  // Confirmed, due, and nobody arrived (migration 065). Set only through
  // POST /reservations/:id/no-show, never by a direct status edit.
  'NO_SHOW',
]);

// A reservation can only be CREATED as PENDING. CONFIRMED is never set directly by a
// client: it is reached through one of the three sanctioned writers named in invariant 3
// — settlePaid() (payment arrived), confirmWithoutPayment() (staff vouched for it), or
// claimOtaBooking() (a Booking.com block gained a real guest). Each audits who did it.
export const UserInputReservationStatusEnum = z.enum([
  'PENDING',
]);

// Where a booking originated — unified channel + CRM origin. Mirrors the
// reservations.source CHECK (DIRECT/WEBSITE from channel sync, BOOKING_COM for OTA
// imports, plus the manual CRM channels).
export const ReservationSourceEnum = z.enum([
  'DIRECT',
  'WEBSITE',
  'WALK_IN',
  'PHONE',
  'EMAIL',
  'BOOKING_COM',
  'CORPORATE',
  'OTHER',
]);

export const CreateReservationSchema = z.object({
  contact_id: z.string().uuid(),
  room_id: z.string().uuid(),
  check_in_date: z.coerce.date(),
  check_out_date: z.coerce.date(),
  notes: z.string().nullable().optional(),
  source: ReservationSourceEnum.default('WALK_IN'),
  status: UserInputReservationStatusEnum.default('PENDING'),
  // CRM (A4): who arranged the booking + who the invoice goes to (both optional).
  booking_coordinator_id: z.string().uuid().nullable().optional(),
  billing_contact_id: z.string().uuid().nullable().optional(),
}).refine(data => data.check_in_date < data.check_out_date, {
  message: "Check-out date must be after check-in date",
  path: ["check_out_date"],
});

export const UpdateReservationSchema = z.object({
  contact_id: z.string().uuid().optional(),
  room_id: z.string().uuid().optional(),
  check_in_date: z.coerce.date().optional(),
  check_out_date: z.coerce.date().optional(),
  notes: z.string().nullable().optional(),
  source: ReservationSourceEnum.optional(),
  status: ReservationStatusEnum.optional(), // Allow status updates explicitly
  booking_coordinator_id: z.string().uuid().nullable().optional(),
  billing_contact_id: z.string().uuid().nullable().optional(),
}).refine((data) => data.status !== 'BLOCKED', {
  message: 'BLOCKED is managed by channel sync and cannot be set manually',
  path: ['status'],
});

// Tier 1 of the OTA contact-info plan: staff copy the guest's details from the
// Booking.com extranet/Pulse app into a real contact, then claim the block with it.
export const ClaimOtaBookingSchema = z.object({
  contact_id: z.string().uuid(),
});

export const DiscountTypeEnum = z.enum(['PERCENT', 'FIXED']);

export const SetDiscountSchema = z
  .object({
    discount_type: DiscountTypeEnum,
    discount_value: z.number().int().positive(), // percent points, or thebe for FIXED
    discount_reason: z.string().max(500).optional().nullable(),
  })
  .refine((d) => d.discount_type !== 'PERCENT' || d.discount_value <= 100, {
    message: 'A percentage discount cannot exceed 100',
    path: ['discount_value'],
  });

// Record a payment already taken off-system (cash at the desk, EFT, mobile money)
// against a PENDING booking, so it can reach CONFIRMED. A booking made on the public
// site arrives with no quote/hold/intent behind it, and only settlePaid() may confirm
// a reservation — so without this there is no path from "guest paid at reception" to
// a confirmed booking. Amount defaults to the booking's own priced total (discount
// applied), which is why it is optional here.
export const MarkPaidSchema = z.object({
  method: z.enum(['CARD', 'MOBILE_MONEY', 'EFT', 'CASH', 'CORPORATE_CREDIT']),
  /** Thebe. Omit to charge the booking's full priced total. */
  amount: z.number().int().positive().optional(),
  /** Bank/receipt reference the guest gave, kept on the payment attempt. */
  reference: z.string().max(200).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

export type CreateReservationDTO = z.infer<typeof CreateReservationSchema>;
export type UpdateReservationDTO = z.infer<typeof UpdateReservationSchema>;
export type SetDiscountDTO = z.infer<typeof SetDiscountSchema>;
export type ClaimOtaBookingDTO = z.infer<typeof ClaimOtaBookingSchema>;
export type MarkPaidDTO = z.infer<typeof MarkPaidSchema>;

// List rows are enriched with guest + room display fields via LEFT JOINs, so the
// UI never shows bare UUIDs and can search by guest name / room code.
export interface ReservationListRow extends ReservationRow {
  guest_name: string | null;
  room_code: string | null;
  room_name: string | null;
  property_id: string | null;
  property_name: string | null;
  // CRM display names for the two optional booking contacts (A4).
  booking_coordinator_name: string | null;
  billing_contact_name: string | null;
}

/**
 * One invoice as it appears on a booking's folio — enough to explain the arithmetic
 * on screen ("what made up the P500 we've received?") without a second request.
 */
export interface FolioInvoiceLine {
  id: string;
  number: string;
  kind: 'DEPOSIT' | 'BALANCE' | 'REFUND';
  status: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED' | 'VOID';
  total_amount: number;
  created_at: Date;
}

/**
 * The MONEY axis of a booking (migration 067) — total / paid / outstanding, all in
 * integer thebe. Orthogonal to `status`: nothing here decides whether the booking
 * holds the room (invariant 7).
 *
 * `total_source` is deliberately on the wire. 'FOLIO' means the agreed price was
 * frozen on the booking and is authoritative. 'PRICED' means it was never frozen and
 * this figure was recomputed from TODAY's rate plan — a best guess that will move if
 * rates move. The UI must be able to tell the guest which one they are looking at.
 */
export interface ReservationFolio {
  reservation_id: string;
  currency: string;
  total_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  payment_state: 'UNPAID' | 'PART_PAID' | 'PAID';
  total_source: 'FOLIO' | 'PRICED';
  invoices: FolioInvoiceLine[];
}

/** The three folio figures alone, for list rows that want a badge, not a breakdown. */
export interface FolioTotals {
  reservation_id: string;
  paid_amount: number;
  outstanding_amount: number;
  payment_state: 'UNPAID' | 'PART_PAID' | 'PAID';
}

export interface ReservationFilters {
  search?: string;
  status?: z.infer<typeof ReservationStatusEnum>;
  source?: z.infer<typeof ReservationSourceEnum>;
  room_id?: string;
  contact_id?: string;
  property_id?: string;
}

export type { CRMRequestMeta as ReservationRequestMeta, PaginatedResult as PaginatedReservationResult, PaginationOptions as ReservationPaginationOptions };
