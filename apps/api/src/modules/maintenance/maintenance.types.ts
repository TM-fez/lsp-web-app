import { z } from 'zod';
import { MAX_MONEY_THEBE } from '../../core/money/limits.js';

export const MaintenanceStatusEnum = z.enum([
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED'
]);

export const MaintenancePriorityEnum = z.enum([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
]);

// (R5, migration 085) The nights a HIGH / CRITICAL repair takes the unit out of use,
// half-open like a booking: from the first night closed to the first night back in use.
// Both or neither — without them the unit is out of use for every date until it's done.
//
// (R6 item 19) Years 0001 / 9999, 30 February and a twenty-year window were all accepted —
// typing slips that either never block or take a unit off sale for good. A real calendar
// day in 2000–2099, and at most a year (366 nights); longer than that, leave the dates
// empty and the unit is closed until the repair is done.
const MAX_REPAIR_NIGHTS = 366;
const realDay = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const isoDay = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/, 'Use a date like 2026-10-14.')
  .refine(realDay, 'That date isn’t on the calendar.');
const nightsBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const blockWindow = {
  blocks_from: isoDay.optional().nullable(),
  blocks_to: isoDay.optional().nullable(),
  // (R6) "Save anyway" after the server warned the repair falls on booked or held nights.
  confirm_overlap: z.boolean().optional(),
};
function windowIsValid(d: { blocks_from?: string | null; blocks_to?: string | null }): boolean {
  const from = d.blocks_from ?? null;
  const to = d.blocks_to ?? null;
  if (from === null && to === null) return true;
  return from !== null && to !== null && to > from && nightsBetween(from, to) <= MAX_REPAIR_NIGHTS;
}
const windowMessage = {
  message: 'Give both repair dates, with the “back in use” day after the first day closed and no more than a year apart — or leave both empty.',
  path: ['blocks_to'],
};

export const CreateWorkOrderSchema = z.object({
  room_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional().nullable(),
  priority: MaintenancePriorityEnum.default('MEDIUM'),
  assigned_to: z.string().uuid().optional().nullable(),
  contractor_name: z.string().max(255).optional().nullable(),
  contractor_phone: z.string().max(50).optional().nullable(),
  cost_amount: z.number().int().min(0).max(MAX_MONEY_THEBE, 'That amount is too large — the most one entry can be is P1,000,000.').optional().nullable(), // thebe
  ...blockWindow,
}).refine(windowIsValid, windowMessage);

export const UpdateWorkOrderSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional().nullable(),
  priority: MaintenancePriorityEnum.optional(),
  contractor_name: z.string().max(255).optional().nullable(),
  contractor_phone: z.string().max(50).optional().nullable(),
  cost_amount: z.number().int().min(0).max(MAX_MONEY_THEBE, 'That amount is too large — the most one entry can be is P1,000,000.').optional().nullable(),
  ...blockWindow,
}).refine(
  // An edit may leave the window alone (neither key sent); when it touches it, both go together.
  (d) => (d.blocks_from === undefined && d.blocks_to === undefined) || windowIsValid(d),
  windowMessage
);

export const CompleteWorkOrderSchema = z.object({
  after_file_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const StartWorkOrderSchema = z.object({
  before_file_id: z.string().uuid().optional().nullable(),
});

export const AssignWorkOrderSchema = z.object({
  assigned_to: z.string().uuid().nullable(),
});

export const SetCostSchema = z.object({
  contractor_name: z.string().max(255).optional().nullable(),
  contractor_phone: z.string().max(50).optional().nullable(),
  cost_amount: z.number().int().min(0).max(MAX_MONEY_THEBE, 'That amount is too large — the most one entry can be is P1,000,000.').optional().nullable(), // thebe
});

export type MaintenanceStatus = z.infer<typeof MaintenanceStatusEnum>;
export type MaintenancePriority = z.infer<typeof MaintenancePriorityEnum>;
export type CreateWorkOrderDTO = z.infer<typeof CreateWorkOrderSchema>;
export type UpdateWorkOrderDTO = z.infer<typeof UpdateWorkOrderSchema>;
export type CompleteWorkOrderDTO = z.infer<typeof CompleteWorkOrderSchema>;
export type StartWorkOrderDTO = z.infer<typeof StartWorkOrderSchema>;
export type AssignWorkOrderDTO = z.infer<typeof AssignWorkOrderSchema>;

// The names behind a work order's accountability columns: who reported it, who
// it's assigned to, who completed it, who approved it. LEFT-joined from users.
export interface WorkOrderPeople {
  reported_by_name: string | null;
  assigned_to_name: string | null;
  completed_by_name: string | null;
  approved_by_name: string | null;
}

export interface MaintenanceQueryDTO {
  page: number;
  limit: number;
  room_id?: string;
  status?: MaintenanceStatus;
  assigned_to?: string;
}

export interface PaginatedMaintenance {
  data: any[];
  total: number;
  page: number;
  limit: number;
}
