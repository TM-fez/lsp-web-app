import { api } from './client';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  property_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationList {
  data: NotificationItem[];
  unread_count: number;
}

/** The bell's dropdown: recent notifications + the unread badge count, in one call. */
export async function listNotifications(limit = 20): Promise<NotificationList> {
  const { data } = await api.get<NotificationList>('/notifications', { params: { limit } });
  return data;
}

export async function markNotificationsRead(ids: string[]): Promise<number> {
  const { data } = await api.post<{ updated: number }>('/notifications/read', { ids });
  return data.updated;
}

export async function markAllNotificationsRead(): Promise<number> {
  const { data } = await api.post<{ updated: number }>('/notifications/read-all');
  return data.updated;
}
