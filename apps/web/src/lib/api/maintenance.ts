import { api } from './client';
import type { WorkOrder, MaintenanceStatus, MaintenancePriority, Paginated } from '@/types';

export interface WorkOrderListParams {
  status?: MaintenanceStatus;
  room_id?: string;
}

export interface CreateWorkOrderInput {
  room_id: string;
  title: string;
  description?: string | null;
  priority?: MaintenancePriority;
  assigned_to?: string | null;
  contractor_name?: string | null;
  contractor_phone?: string | null;
  cost_amount?: number | null; // thebe
  blocks_from?: string | null; // YYYY-MM-DD, first night closed
  blocks_to?: string | null; // YYYY-MM-DD, first night back in use
  confirm_overlap?: boolean; // (R6) "Save anyway" over booked / held nights
}

export type UpdateWorkOrderInput = Partial<
  Pick<CreateWorkOrderInput, 'title' | 'description' | 'priority' | 'blocks_from' | 'blocks_to' | 'confirm_overlap'>
>;

export const WORK_ORDER_LIST_LIMIT = 100;

export async function listWorkOrders(params?: WorkOrderListParams): Promise<Paginated<WorkOrder>> {
  const { data } = await api.get<Paginated<WorkOrder>>('/maintenance', {
    params: { limit: WORK_ORDER_LIST_LIMIT, ...params },
  });
  return data;
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
  const { data } = await api.post<WorkOrder>('/maintenance', input);
  return data;
}

export async function updateWorkOrder(id: string, input: UpdateWorkOrderInput): Promise<WorkOrder> {
  const { data } = await api.patch<WorkOrder>(`/maintenance/${id}`, input);
  return data;
}

// Lifecycle endpoints expect a JSON body (the controller parses req.body), so always
// send an object — even an empty one — or the schema parse 400s before the guard runs.
export async function startWorkOrder(id: string): Promise<WorkOrder> {
  const { data } = await api.post<WorkOrder>(`/maintenance/${id}/start`, {});
  return data;
}

export async function assignWorkOrder(id: string, assignedTo: string | null): Promise<WorkOrder> {
  const { data } = await api.patch<WorkOrder>(`/maintenance/${id}/assign`, { assigned_to: assignedTo });
  return data;
}

export async function setWorkOrderCost(
  id: string,
  input: { contractor_name?: string | null; contractor_phone?: string | null; cost_amount?: number | null },
): Promise<WorkOrder> {
  const { data } = await api.patch<WorkOrder>(`/maintenance/${id}/cost`, input);
  return data;
}

export async function completeWorkOrder(id: string, notes?: string | null): Promise<WorkOrder> {
  const { data } = await api.post<WorkOrder>(`/maintenance/${id}/complete`, { notes: notes ?? null });
  return data;
}

// Management sign-off on a completed repair (requires maintenance.approve).
export async function approveWorkOrder(id: string): Promise<WorkOrder> {
  const { data } = await api.post<WorkOrder>(`/maintenance/${id}/approve`, {});
  return data;
}

export async function cancelWorkOrder(id: string, restoreRoom: boolean): Promise<WorkOrder> {
  const { data } = await api.post<WorkOrder>(`/maintenance/${id}/cancel`, { restore_room: restoreRoom });
  return data;
}
