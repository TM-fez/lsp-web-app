import { z } from 'zod';
import type { ReservationRow } from '../../db/types.js';
import type { CRMRequestMeta, PaginatedResult, PaginationOptions } from '../crm/crm.types.js';

export const ReservationStatusEnum = z.enum([
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
]);

// A reservation can only be CREATED as PENDING. CONFIRMED is reached solely
// through settlePaid() (payment) — it can never be set directly by a client.
export const UserInputReservationStatusEnum = z.enum([
  'PENDING',
]);

export const CreateReservationSchema = z.object({
  contact_id: z.string().uuid(),
  room_id: z.string().uuid(),
  check_in_date: z.coerce.date(),
  check_out_date: z.coerce.date(),
  notes: z.string().nullable().optional(),
  status: UserInputReservationStatusEnum.default('PENDING'),
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
  status: ReservationStatusEnum.optional(), // Allow status updates explicitly
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

export type CreateReservationDTO = z.infer<typeof CreateReservationSchema>;
export type UpdateReservationDTO = z.infer<typeof UpdateReservationSchema>;
export type SetDiscountDTO = z.infer<typeof SetDiscountSchema>;

// List rows are enriched with guest + room display fields via LEFT JOINs, so the
// UI never shows bare UUIDs and can search by guest name / room code.
export interface ReservationListRow extends ReservationRow {
  guest_name: string | null;
  room_code: string | null;
  room_name: string | null;
  property_id: string | null;
  property_name: string | null;
}

export interface ReservationFilters {
  search?: string;
  status?: z.infer<typeof ReservationStatusEnum>;
  room_id?: string;
  contact_id?: string;
  property_id?: string;
}

export type { CRMRequestMeta as ReservationRequestMeta, PaginatedResult as PaginatedReservationResult, PaginationOptions as ReservationPaginationOptions };
