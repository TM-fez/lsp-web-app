import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ActivePropertyState {
  /** The property the user is currently working in. Sent as X-Property-Id on
   *  every API request and enforced server-side. Null until one is picked. */
  activePropertyId: string | null;
  setActiveProperty: (id: string) => void;
  clear: () => void;
}

/**
 * Which property the portal is scoped to. After login the user picks one (or is
 * auto-scoped when they only have access to a single property). Persisted so a
 * reload keeps you in the same property; the server re-validates membership on
 * every request, so a stale id can never grant access.
 */
export const useActivePropertyStore = create<ActivePropertyState>()(
  persist(
    (set) => ({
      activePropertyId: null,
      setActiveProperty: (id) => set({ activePropertyId: id }),
      clear: () => set({ activePropertyId: null }),
    }),
    { name: 'lsp-active-property' },
  ),
);
