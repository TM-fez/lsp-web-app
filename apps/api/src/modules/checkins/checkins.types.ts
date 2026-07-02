import { z } from 'zod';

export const OccupancyStatusEnum = z.enum([
  'CHECKED_IN',
  'CHECKED_OUT',
]);

// room_id is derived from the reservation (not user-supplied) so it always
// matches the reservation's room. checked_out_at is set at check-out time.
export const CreateCheckInSchema = z.object({
  reservation_id: z.string().uuid(),
  guest_count: z.coerce.number().int().positive().default(1),
  notes: z.string().nullable().optional(),
  checked_in_at: z.coerce.date().optional(),
});

export const CheckOutSchema = z.object({
  checked_out_at: z.coerce.date().optional(),
  notes: z.string().nullable().optional(),
});

export type CreateCheckInDTO = z.infer<typeof CreateCheckInSchema>;
export type CheckOutDTO = z.infer<typeof CheckOutSchema>;

export interface OccupancyFilters {
  // H5: restrict to one property via the entity's room -> building chain.
  property_id?: string;
  status?: z.infer<typeof OccupancyStatusEnum>;
  room_id?: string;
  reservation_id?: string;
}

export interface OccupancyPaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedOccupancyResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface OccupancyRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}
