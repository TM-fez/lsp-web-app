/**
 * Idempotency-Key support for the money-moving POSTs (refund, payment, mark-paid, cost,
 * guest). The server stores the answer to the first request carrying a key and replays it
 * for any repeat of that SAME request, so a double click or a retry after a flaky network
 * can't post twice.
 *
 * Make ONE key each time a form/dialog opens and send it with every submit from that
 * form. A new key per click would defeat the point.
 */

/** A fresh random key (UUID v4). `crypto.randomUUID` needs a secure context, so fall back. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

/** Axios request config carrying the key — or nothing at all when there is no key. */
export function idempotencyConfig(key?: string): { headers: { 'Idempotency-Key': string } } | undefined {
  return key ? { headers: { 'Idempotency-Key': key } } : undefined;
}

/**
 * (R6 NEW-1) Did the server REPLAY a stored answer instead of doing the work? It sets
 * `Idempotent-Replayed: true` on a repeat of the same request (a double click, a retry),
 * which changed nothing — so the screen must not announce a second success.
 */
export function wasReplayed(headers: unknown): boolean {
  const h = headers as Record<string, unknown> | undefined;
  return String(h?.['idempotent-replayed'] ?? '').toLowerCase() === 'true';
}
