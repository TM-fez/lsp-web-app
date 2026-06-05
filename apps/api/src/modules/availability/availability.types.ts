import { z } from 'zod';
import { RoomTypeEnum } from '../rooms/rooms.types.js';

// Aggregate availability status for a calendar day or a quote summary.
export const AvailabilityStatusEnum = z.enum([
  'AVAILABLE',
  'LIMITED',
  'FULL',
  'BLOCKED',
]);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusEnum>;

// Why a specific room is not bookable for the requested range.
export type BlockReason = 'MAINTENANCE' | 'OUT_OF_SERVICE' | 'OCCUPIED' | 'RESERVED';

const MAX_RANGE_DAYS = 366;
const rangeRefinement = (d: { check_in: Date; check_out: Date }) => d.check_in < d.check_out;
const rangeMessage = { message: 'check_out must be after check_in', path: ['check_out'] };

// GET /availability and /availability/rooms
export const AvailabilityQuerySchema = z
  .object({
    check_in: z.coerce.date(),
    check_out: z.coerce.date(),
    guests: z.coerce.number().int().positive().optional(),
    room_type: RoomTypeEnum.optional(),
    capacity: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .refine(rangeRefinement, rangeMessage);

// GET /availability/calendar — bounded window for performance
export const AvailabilityCalendarSchema = z
  .object({
    check_in: z.coerce.date(),
    check_out: z.coerce.date(),
    room_type: RoomTypeEnum.optional(),
    capacity: z.coerce.number().int().positive().optional(),
  })
  .refine(rangeRefinement, rangeMessage)
  .refine(
    (d) => (d.check_out.getTime() - d.check_in.getTime()) / 86_400_000 <= MAX_RANGE_DAYS,
    { message: `calendar range cannot exceed ${MAX_RANGE_DAYS} days`, path: ['check_out'] }
  );

// POST /availability/quote
export const AvailabilityQuoteSchema = z
  .object({
    check_in: z.coerce.date(),
    check_out: z.coerce.date(),
    guests: z.coerce.number().int().positive().optional(),
    room_type: RoomTypeEnum.optional(),
    capacity: z.coerce.number().int().positive().optional(),
  })
  .refine(rangeRefinement, rangeMessage);

export type AvailabilityQueryDTO = z.infer<typeof AvailabilityQuerySchema>;
export type AvailabilityCalendarDTO = z.infer<typeof AvailabilityCalendarSchema>;
export type AvailabilityQuoteDTO = z.infer<typeof AvailabilityQuoteSchema>;

export interface DateRange {
  checkIn: Date;
  checkOut: Date;
}

export interface AvailabilityFilters {
  roomType?: z.infer<typeof RoomTypeEnum>;
  minCapacity: number; // derived from max(guests, capacity); 0 means no constraint
}

// ── Repository row shapes (raw signals; no domain verdict) ─────────────────────

export interface RoomSignalRow {
  id: string;
  name: string;
  code: string;
  type: z.infer<typeof RoomTypeEnum>;
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
  capacity: number;
  overlapping_reservations: number;
  active_occupancy: number;
  total_count: number; // window count for pagination
}

export interface SummaryCountsRow {
  total: number;
  available: number;
  maintenance: number;
  out_of_service: number;
  occupied: number;
  reserved: number;
}

export interface CalendarDayRow {
  day: string;
  total_rooms: number;
  structural_blocked: number;
  free_rooms: number;
}

// ── Service result shapes ─────────────────────────────────────────────────────

export interface RoomVerdict {
  id: string;
  name: string;
  code: string;
  type: z.infer<typeof RoomTypeEnum>;
  capacity: number;
  room_status: RoomSignalRow['status'];
  available: boolean;
  reason: BlockReason | null;
}

export interface AvailabilityResult {
  range: { check_in: string; check_out: string };
  page: number;
  limit: number;
  total: number;
  rooms: RoomVerdict[];
}

export interface AvailableRoomsResult {
  range: { check_in: string; check_out: string };
  page: number;
  limit: number;
  total: number;
  data: RoomVerdict[];
}

export interface CalendarDay {
  day: string;
  status: AvailabilityStatus;
  total: number;
  free: number;
  blocked: number;
}

export interface QuoteResult {
  range: { check_in: string; check_out: string };
  status: AvailabilityStatus;
  total_rooms: number;
  available_rooms: number;
  blocked_rooms: number;
  occupancy_rate: number;
  breakdown: {
    maintenance: number;
    out_of_service: number;
    occupied: number;
    reserved: number;
  };
}
