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
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-14.');
const blockWindow = {
  blocks_from: isoDay.optional().nullable(),
  blocks_to: isoDay.optional().nullable(),
};
function windowIsValid(d: { blocks_from?: string | null; blocks_to?: string | null }): boolean {
  const from = d.blocks_from ?? null;
  const to = d.blocks_to ?? null;
  if (from === null && to === null) return true;
  return from !== null && to !== null && to > from;
}
const windowMessage = {
  message: 'Give both repair dates, with the “back in use” day after the first day closed — or leave both empty.',
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
