import { api } from './client';

export type HousekeepingAction = 'start' | 'inspect' | 'ready';

/** Advance a unit through its turn: start (clean) -> inspect -> ready. */
export async function transition(roomId: string, action: HousekeepingAction): Promise<void> {
  await api.post(`/housekeeping/rooms/${roomId}/${action}`, {});
}
