// Money is stored as integer minor units (thebe; 100 thebe = 1 BWP).
// Operators think in Pula, so forms convert at the edge.

export function formatMoney(minor: number, currency = 'BWP'): string {
  const pula = (minor / 100).toFixed(2);
  // group thousands without relying on a specific locale being present
  const [whole, frac] = pula.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${grouped}.${frac}`;
}

/** "500" or "500.50" (Pula) -> thebe integer. Returns NaN for blank/invalid. */
export function pulaToThebe(pula: string | number): number {
  const n = typeof pula === 'number' ? pula : parseFloat(String(pula).replace(/,/g, '').trim());
  if (Number.isNaN(n)) return NaN;
  return Math.round(n * 100);
}

/** thebe -> "500.00" string for prefilling a Pula input. */
export function thebeToPula(minor: number): string {
  return (minor / 100).toFixed(2);
}

/** basis points (1400) -> percent string ("14"). */
export function bpsToPct(bps: number): string {
  return String(bps / 100);
}

/** percent ("14" or "14.5") -> basis points integer. Returns NaN for invalid. */
export function pctToBps(pct: string | number): number {
  const n = typeof pct === 'number' ? pct : parseFloat(String(pct).trim());
  if (Number.isNaN(n)) return NaN;
  return Math.round(n * 100);
}
