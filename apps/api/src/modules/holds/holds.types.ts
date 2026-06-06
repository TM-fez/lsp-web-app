import { z } from 'zod';

export const HoldStatusEnum = z.enum(['HELD', 'CONFIRMED', 'EXPIRED', 'RELEASED']);
export type HoldStatus = z.infer<typeof HoldStatusEnum>;

export const CreateHoldSchema = z.object({
  quote_id: z.string().uuid(),
  room_id: z.string().uuid().optional().nullable(),
  reservation_id: z.string().uuid().optional().nullable(),
});

export const ReleaseHoldSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type CreateHoldDTO = z.infer<typeof CreateHoldSchema>;
export type ReleaseHoldDTO = z.infer<typeof ReleaseHoldSchema>;

export interface HoldFilters {
  status?: HoldStatus;
  quote_id?: string;
}

export interface HoldRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}
