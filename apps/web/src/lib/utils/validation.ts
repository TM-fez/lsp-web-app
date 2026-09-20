/**
 * Lightweight form gates for public guest flows — not exhaustive RFC parsing,
 * just enough to keep junk out of lead/booking payloads before submit.
 */

/** True when the string looks like a usable email address. */
export function isValidEmail(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 5) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
