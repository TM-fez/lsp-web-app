import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  transition,
  getChecklist,
  addChecklistItem,
  updateChecklistItem,
  getRoomChecks,
  setRoomCheck,
  getTurnaround,
  type ChecklistItem,
  type HousekeepingAction,
  type RoomChecks,
  type Turnaround,
} from '@/lib/api/housekeeping';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import { turnResult } from './util';

/**
 * Advance a unit's cleaning turn and refresh everything that shows unit state:
 * this board (rooms) and the cockpit board.
 */
export function useTurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, action }: { roomId: string; action: HousekeepingAction }) =>
      transition(roomId, action),
    onSuccess: (_data, { action }) => {
      toast.success(turnResult[action]);
      qc.invalidateQueries({ queryKey: ['rooms'] });
      qc.invalidateQueries({ queryKey: ['cockpit-board'] });
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

// ── Compliance checklist ─────────────────────────────────────────────────────

/** The company cleaning standard (managers pass includeInactive to curate it). */
export function useChecklist(includeInactive = false, enabled = true) {
  return useQuery<ChecklistItem[]>({
    queryKey: ['hk-checklist', includeInactive],
    queryFn: () => getChecklist(includeInactive),
    enabled,
  });
}

export function useAddChecklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (label: string) => addChecklistItem(label),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hk-checklist'] }),
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateChecklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ChecklistItem, 'label' | 'sort_order' | 'active'>> }) =>
      updateChecklistItem(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hk-checklist'] }),
    onError: (e) => toast.error(errMessage(e)),
  });
}

/** A unit's live-task ticks — only fetched while its checklist dialog is open. */
export function useRoomChecks(roomId: string | null) {
  return useQuery<RoomChecks>({
    queryKey: ['hk-room-checks', roomId],
    queryFn: () => getRoomChecks(roomId!),
    enabled: !!roomId,
  });
}

export function useSetRoomCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, itemId, checked }: { roomId: string; itemId: string; checked: boolean }) =>
      setRoomCheck(roomId, itemId, checked),
    onSuccess: (data, { roomId }) => qc.setQueryData(['hk-room-checks', roomId], data),
    onError: (e) => toast.error(errMessage(e)),
  });
}

/** Avg turnaround KPI for the active property. */
export function useTurnaround(days = 30) {
  return useQuery<Turnaround>({
    queryKey: ['hk-turnaround', days],
    queryFn: () => getTurnaround(days),
  });
}
