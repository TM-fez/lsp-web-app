import { z } from 'zod';

// Unit readiness (denormalized onto rooms.housekeeping_status).
export const HousekeepingStatusEnum = z.enum(['READY', 'DIRTY', 'CLEANING', 'INSPECTED']);
// Lifecycle of a single cleaning task.
export const HousekeepingTaskStatusEnum = z.enum(['OPEN', 'CLEANING', 'INSPECTED', 'DONE']);

export type HousekeepingStatus = z.infer<typeof HousekeepingStatusEnum>;
export type HousekeepingTaskStatus = z.infer<typeof HousekeepingTaskStatusEnum>;

// DIRTY -> CLEANING: a housekeeper picks up the turn (optionally assigned).
export const StartCleaningSchema = z.object({
  assigned_to: z.string().uuid().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

// CLEANING -> INSPECTED: cleaning done, awaiting inspection sign-off.
export const InspectSchema = z.object({
  notes: z.string().max(500).optional().nullable(),
});

// INSPECTED -> READY: passes inspection, unit is assignable again.
export const ReadySchema = z.object({
  notes: z.string().max(500).optional().nullable(),
});

export type StartCleaningDTO = z.infer<typeof StartCleaningSchema>;
export type InspectDTO = z.infer<typeof InspectSchema>;
export type ReadyDTO = z.infer<typeof ReadySchema>;

// ── Compliance checklist (Phase 3) ─────────────────────────────────────────────

export const ChecklistItemCreateSchema = z.object({
  label: z.string().min(1).max(200),
  sort_order: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const ChecklistItemUpdateSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  sort_order: z.coerce.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});

// Tick or untick one item on a unit's live task.
export const SetCheckSchema = z.object({
  item_id: z.string().uuid(),
  checked: z.boolean(),
});

export type ChecklistItemCreateDTO = z.infer<typeof ChecklistItemCreateSchema>;
export type ChecklistItemUpdateDTO = z.infer<typeof ChecklistItemUpdateSchema>;
export type SetCheckDTO = z.infer<typeof SetCheckSchema>;

export interface HousekeepingQueryDTO {
  page: number;
  limit: number;
  status?: HousekeepingTaskStatus;
  room_id?: string;
  assigned_to?: string;
}

export interface HousekeepingRequestMeta {
  userId: string;
  requestId?: string;
}
