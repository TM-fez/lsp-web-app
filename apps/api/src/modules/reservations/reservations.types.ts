import { z } from 'zod';
import type { CRMRequestMeta, PaginatedResult, PaginationOptions } from '../crm.types';

export const ReservationStatusEnum = z.enum([
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
]);

// Exclude statuses that user shouldn't force create with
export const UserInputReservationStatusEnum = z.enum([
  'PENDING',
  'CONFIRMED',
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

export interface ReservationFilters {
  search?: string;
  status?: z.infer<typeof ReservationStatusEnum>;
  room_id?: string;
  contact_id?: string;
}

export type { CRMRequestMeta as ReservationRequestMeta, PaginatedResult as PaginatedReservationResult, PaginationOptions as ReservationPaginationOptions };
