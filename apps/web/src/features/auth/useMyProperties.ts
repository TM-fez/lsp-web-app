import { useQuery } from '@tanstack/react-query';
import { fetchMe } from '@/lib/api/auth';
import { useAuthStore } from '@/store/auth';
import type { MyProperty } from '@/types';

/**
 * The properties the signed-in user may enter. Drives the post-login picker and
 * the Topbar switcher. Cached for the session; only enabled once authenticated.
 */
export function useMyProperties() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery<MyProperty[]>({
    queryKey: ['my-properties'],
    queryFn: async () => (await fetchMe()).properties,
    enabled: !!token,
    staleTime: 5 * 60_000,
  });
}
