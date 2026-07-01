import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type NotificationList,
} from '@/lib/api/notifications';
import { useAuthStore } from '@/store/auth';

const KEY = ['notifications'];

/**
 * The signed-in user's recent notifications + unread count. Polls in the
 * background so the bell badge stays current without a manual refresh; only
 * enabled once authenticated.
 */
export function useNotifications() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery<NotificationList>({
    queryKey: KEY,
    queryFn: () => listNotifications(20),
    enabled: !!token,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => markNotificationsRead(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
