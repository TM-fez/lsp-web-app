import { z } from 'zod';

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

export const CreateWorkOrderSchema = z.object({
  room_id: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  priority: MaintenancePriorityEnum.default('MEDIUM'),
  assigned_to: z.string().uuid().optional().nullable(),
  contractor_name: z.string().max(255).optional().nullable(),
  contractor_phone: z.string().max(50).optional().nullable(),
  cost_amount: z.number().int().min(0).optional().nullable(), // thebe
});

export const UpdateWorkOrderSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  priority: MaintenancePriorityEnum.optional(),
  contractor_name: z.string().max(255).optional().nullable(),
  contractor_phone: z.string().max(50).optional().nullable(),
  cost_amount: z.number().int().min(0).optional().nullable(),
});

export const CompleteWorkOrderSchema = z.object({
  after_file_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
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
  cost_amount: z.number().int().min(0).optional().nullable(), // thebe
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
