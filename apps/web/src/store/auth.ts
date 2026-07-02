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
 * The access token is PERSISTED (localStorage via zustand/persist) so reloads keep
 * the session; the refresh token is an httpOnly cookie the browser sends
 * automatically, and on a 401 the API client silently refreshes (lib/api/client.ts).
 *
 * DELIBERATE decision (H3 review): we keep localStorage rather than memory-only.
 * An XSS that can read localStorage can equally well call /auth/refresh from the
 * page (the cookie rides along same-origin) and mint itself a fresh token — so
 * moving the token to memory buys ~nothing against the actual threat. The real
 * defence is preventing script injection: the CSP in vercel.json (script-src
 * 'self') plus React's escaping. Tokens expire in 15 minutes regardless.
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
