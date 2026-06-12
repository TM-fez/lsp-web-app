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
  // Multi-property: which building this unit sits in, plus an optional floor label.
  building_id: z.string().uuid().nullable().optional(),
  floor: z.coerce.number().int().min(0).max(200).nullable().optional(),
});

// Status changes go through the dedicated maintenance/out-of-service/restore
// endpoints (which enforce the transition rules), so it is not patchable here.
export const UpdateRoomSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  type: RoomTypeEnum.optional(),
  capacity: z.coerce.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
  building_id: z.string().uuid().nullable().optional(),
  floor: z.coerce.number().int().min(0).max(200).nullable().optional(),
});

export type CreateRoomDTO = z.infer<typeof CreateRoomSchema>;
export type UpdateRoomDTO = z.infer<typeof UpdateRoomSchema>;

export interface RoomFilters {
  search?: string;
  status?: z.infer<typeof RoomStatusEnum>;
  type?: z.infer<typeof RoomTypeEnum>;
  property_id?: string;
  building_id?: string;
}

// A room row enriched with its building + property names (for the list/board).
export interface RoomListRow {
  id: string;
  name: string;
  code: string;
  type: z.infer<typeof RoomTypeEnum>;
  status: z.infer<typeof RoomStatusEnum>;
  housekeeping_status: 'READY' | 'DIRTY' | 'CLEANING' | 'INSPECTED';
  capacity: number;
  notes: string | null;
  building_id: string | null;
  floor: number | null;
  building_name: string | null;
  property_id: string | null;
  property_name: string | null;
  created_by: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
  image_file_id?: string | null;
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
