import { z } from 'zod';

export const RoomStatusEnum = z.enum([
  'AVAILABLE',
  'OCCUPIED',
  'MAINTENANCE',
  'OUT_OF_SERVICE',
]);

export const RoomTypeEnum = z.enum([
  'STANDARD',
  'DELUXE',
  'SUITE',
  'CONFERENCE',
  'CUSTOM',
]);

// OCCUPIED is set by the occupancy/check-in flow, not chosen on create.
export const UserInputRoomStatusEnum = z.enum([
  'AVAILABLE',
  'MAINTENANCE',
  'OUT_OF_SERVICE',
]);

export const CreateRoomSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50),
  type: RoomTypeEnum.default('STANDARD'),
  status: UserInputRoomStatusEnum.default('AVAILABLE'),
  capacity: z.coerce.number().int().positive().default(1),
  notes: z.string().nullable().optional(),
});

// Status changes go through the dedicated maintenance/out-of-service/restore
// endpoints (which enforce the transition rules), so it is not patchable here.
export const UpdateRoomSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  type: RoomTypeEnum.optional(),
  capacity: z.coerce.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
});

export type CreateRoomDTO = z.infer<typeof CreateRoomSchema>;
export type UpdateRoomDTO = z.infer<typeof UpdateRoomSchema>;

export interface RoomFilters {
  search?: string;
  status?: z.infer<typeof RoomStatusEnum>;
  type?: z.infer<typeof RoomTypeEnum>;
}

export interface RoomPaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedRoomResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface RoomRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}
