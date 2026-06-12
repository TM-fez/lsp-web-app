import { api } from './client';

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  entity: string;
  created_at: string;
}

export async function listActivity(limit = 20): Promise<ActivityItem[]> {
  const { data } = await api.get<{ data: ActivityItem[] }>('/activity', { params: { limit } });
  return data.data;
}
