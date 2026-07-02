import { api } from './client';

export type HousekeepingAction = 'start' | 'inspect' | 'ready';

/** Advance a unit through its turn: start (clean) -> inspect -> ready. */
export async function transition(roomId: string, action: HousekeepingAction): Promise<void> {
  await api.post(`/housekeeping/rooms/${roomId}/${action}`, {});
}

// ── Compliance checklist (Phase 3) ─────────────────────────────────────────────

/** One item of the company cleaning standard. */
export interface ChecklistItem {
  id: string;
  label: string;
  sort_order: number;
  active: boolean;
}

/** A unit's live-task checklist: every active item + whether it's ticked. */
export interface RoomChecks {
  task_id: string;
  task_status: 'OPEN' | 'CLEANING' | 'INSPECTED' | 'DONE';
  items: { id: string; label: string; checked: boolean }[];
}

export async function getChecklist(includeInactive = false): Promise<ChecklistItem[]> {
  const { data } = await api.get<{ data: ChecklistItem[] }>(
    `/housekeeping/checklist${includeInactive ? '?include_inactive=true' : ''}`,
  );
  return data.data;
}

export async function addChecklistItem(label: string): Promise<ChecklistItem> {
  const { data } = await api.post<ChecklistItem>('/housekeeping/checklist', { label });
  return data;
}

export async function updateChecklistItem(
  id: string,
  patch: Partial<Pick<ChecklistItem, 'label' | 'sort_order' | 'active'>>,
): Promise<ChecklistItem> {
  const { data } = await api.patch<ChecklistItem>(`/housekeeping/checklist/${id}`, patch);
  return data;
}

export async function getRoomChecks(roomId: string): Promise<RoomChecks> {
  const { data } = await api.get<RoomChecks>(`/housekeeping/rooms/${roomId}/checks`);
  return data;
}

export async function setRoomCheck(roomId: string, itemId: string, checked: boolean): Promise<RoomChecks> {
  const { data } = await api.post<RoomChecks>(`/housekeeping/rooms/${roomId}/checks`, {
    item_id: itemId,
    checked,
  });
  return data;
}

// ── Turnaround tracking ─────────────────────────────────────────────────────────

/** Avg DIRTY → signed-off READY minutes for the active property. */
export interface Turnaround {
  days: number;
  completed: number;
  avg_minutes: number | null;
}

export async function getTurnaround(days = 30): Promise<Turnaround> {
  const { data } = await api.get<Turnaround>(`/housekeeping/turnaround?days=${days}`);
  return data;
}
