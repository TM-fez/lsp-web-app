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

export type CreateReservationDTO = z.infer<typeof CreateReservationSchema>;
export type UpdateReservationDTO = z.infer<typeof UpdateReservationSchema>;

// List rows are enriched with guest + room display fields via LEFT JOINs, so the
// UI never shows bare UUIDs and can search by guest name / room code.
export interface ReservationListRow extends ReservationRow {
  guest_name: string | null;
  room_code: string | null;
  room_name: string | null;
}

export interface ReservationFilters {
  search?: string;
  status?: z.infer<typeof ReservationStatusEnum>;
  room_id?: string;
  contact_id?: string;
}

export type { CRMRequestMeta as ReservationRequestMeta, PaginatedResult as PaginatedReservationResult, PaginationOptions as ReservationPaginationOptions };
