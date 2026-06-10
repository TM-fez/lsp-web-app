import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  listWorkOrders,
  createWorkOrder,
  updateWorkOrder,
  startWorkOrder,
  completeWorkOrder,
  cancelWorkOrder,
  type WorkOrderListParams,
  type CreateWorkOrderInput,
  type UpdateWorkOrderInput,
} from '@/lib/api/maintenance';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { WorkOrder, Paginated } from '@/types';

const MAINTENANCE_KEY = ['maintenance'] as const;

export function useWorkOrders(params: WorkOrderListParams) {
  return useQuery<Paginated<WorkOrder>>({
    queryKey: [...MAINTENANCE_KEY, params],
    queryFn: () => listWorkOrders(params),
    placeholderData: keepPreviousData,
  });
}

/**
 * Most maintenance changes also move the unit's room status (opening sends it to
 * MAINTENANCE, completing/cancel-restore sends it back to AVAILABLE), so refresh
 * the rooms list and the cockpit board alongside the work-order list.
 */
function useRefresh(touchesRoom: boolean) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: MAINTENANCE_KEY });
    if (touchesRoom) {
      qc.invalidateQueries({ queryKey: ['rooms'] });
      qc.invalidateQueries({ queryKey: ['cockpit-board'] });
    }
  };
}

export function useCreateWorkOrder() {
  const refresh = useRefresh(true);
  return useMutation({
    mutationFn: (input: CreateWorkOrderInput) => createWorkOrder(input),
    onSuccess: () => {
      toast.success('Repair logged — unit set to maintenance');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateWorkOrder() {
  const refresh = useRefresh(false);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateWorkOrderInput }) => updateWorkOrder(id, input),
    onSuccess: () => {
      toast.success('Work order updated');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useStartWorkOrder() {
  const refresh = useRefresh(false);
  return useMutation({
    mutationFn: (id: string) => startWorkOrder(id),
    onSuccess: () => {
      toast.success('Work started');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useCompleteWorkOrder() {
  const refresh = useRefresh(true);
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string | null }) => completeWorkOrder(id, notes),
    onSuccess: () => {
      toast.success('Marked fixed — unit available again ✨');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useCancelWorkOrder() {
  const refresh = useRefresh(true);
  return useMutation({
    mutationFn: ({ id, restoreRoom }: { id: string; restoreRoom: boolean }) => cancelWorkOrder(id, restoreRoom),
    onSuccess: () => {
      toast.success('Work order cancelled');
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
