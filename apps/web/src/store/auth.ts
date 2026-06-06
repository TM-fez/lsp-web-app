import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@/types';

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  setToken: (token: string) => void;
  clear: () => void;
  hasPerm: (perm: string) => boolean;
}

/**
 * Access token lives in memory (persisted for reloads); the refresh token is an
 * httpOnly cookie the browser sends automatically. On a 401 the API client
 * silently refreshes — see lib/api/client.ts.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,
      setAuth: (accessToken, user) => set({ accessToken, user }),
      setToken: (accessToken) => set({ accessToken }),
      clear: () => set({ accessToken: null, user: null }),
      hasPerm: (perm) => get().user?.permissions.includes(perm) ?? false,
    }),
    { name: 'lsp-auth' },
  ),
);
