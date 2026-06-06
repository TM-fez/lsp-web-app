import { api } from './client';
import type { CockpitBoard } from '@/types';

export async function getBoard(): Promise<CockpitBoard> {
  const { data } = await api.get<CockpitBoard>('/cockpit/board');
  return data;
}
