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

// Whose unit this is — Lifestyle's own or a third-party landlord's (migration 054).
// Drives the repair-cost owner attribution in the expenses view.
export const RoomOwnershipEnum = z.enum(['LIFESTYLE', 'LANDLORD']);

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
  // Ownership attribution + landlord contact (free text, wa.me-able phone).
  ownership: RoomOwnershipEnum.default('LIFESTYLE'),
  landlord_name: z.string().max(255).nullable().optional(),
  landlord_phone: z.string().max(50).nullable().optional(),
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
  ownership: RoomOwnershipEnum.optional(),
  landlord_name: z.string().max(255).nullable().optional(),
  landlord_phone: z.string().max(50).nullable().optional(),
});

// Channel sync config: where the importer PULLS this unit's Booking.com calendar
// from. https + a booking.com host only — the URL is fetched SERVER-SIDE on a
// 15-min cron, so it must never be pointable at arbitrary or internal endpoints.
export const UpdateChannelConfigSchema = z.object({
  booking_ical_url: z
    .string()
    .trim()
    .url()
    .refine(
      (u) => {
        try {
          const { protocol, hostname } = new URL(u);
          return protocol === 'https:' && (hostname === 'booking.com' || hostname.endsWith('.booking.com'));
        } catch {
          return false;
        }
      },
      { message: 'Must be an https:// URL on a booking.com host' },
    )
    .nullable(),
});

export type CreateRoomDTO = z.infer<typeof CreateRoomSchema>;
export type UpdateRoomDTO = z.infer<typeof UpdateRoomSchema>;
export type UpdateChannelConfigDTO = z.infer<typeof UpdateChannelConfigSchema>;

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
