import { useSyncExternalStore } from 'react';

/**
 * (R6) True below Tailwind's `sm` breakpoint (640 px) — a phone held upright.
 *
 * Wide money tables (Invoices) can't be squeezed into 390 px: the amount, status and the
 * action button end up off-screen behind a sideways scroll. Those screens render a card
 * list instead on a phone. Choosing in JS rather than CSS keeps ONE copy of each row on
 * the page (no duplicate buttons, no duplicate text for screen readers or tests). Where
 * `matchMedia` is missing (old browsers, jsdom) it answers false — the desktop table.
 */
const QUERY = '(max-width: 639px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.('change', onChange);
  return () => mq.removeEventListener?.('change', onChange);
}

function snapshot(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

export function useSmallScreen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
