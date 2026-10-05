// Money is stored as integer minor units (thebe; 100 thebe = 1 BWP).
// Operators think in Pula, so forms convert at the edge.

export function formatMoney(minor: number, currency = 'BWP'): string {
  const pula = (minor / 100).toFixed(2);
  // group thousands without relying on a specific locale being present
  const [whole, frac] = pula.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${grouped}.${frac}`;
}

/** The one shape a typed Pula amount may take: digits, optionally a dot and 1–2 decimals. */
const PULA_AMOUNT = /^\d+(\.\d{1,2})?$/;

/**
 * "500" or "500.50" (Pula) -> thebe integer. Returns NaN for blank or anything that is not
 * exactly a Pula amount.
 *
 * STRICT on purpose (Round 4 N-2). This used to strip every comma, so "10,5" — a decimal
 * comma, the way many people write it — silently became P105.00, ten times what was typed,
 * and sailed through every "is it a number?" check. Now a comma (decimal OR thousands),
 * a space inside the number, a third decimal place, a sign or any letter gives NaN, and
 * every caller already treats NaN as "not a valid amount". Use pulaAmountError() to say WHY.
 *
 * A number is taken as-is (rounded to the nearest thebe); it can't contain a comma.
 */
export function pulaToThebe(pula: string | number): number {
  if (typeof pula === 'number') return Number.isFinite(pula) ? Math.round(pula * 100) : NaN;
  const t = pula.trim();
  if (!PULA_AMOUNT.test(t)) return NaN;
  // Parse the digits, not the float: "1.15" * 100 is 114.99999999999999.
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/**
 * Is this typed text a well-formed Pula amount — digits with at most two decimal places and
 * a DOT as the only separator? "10.005" isn't: there is no half-thebe, and silently
 * rounding it records an amount the operator never typed. Neither is "10,5" or "1,250".
 */
export function isPulaAmount(pula: string): boolean {
  return PULA_AMOUNT.test(pula.trim());
}

/**
 * Why a typed Pula amount is not acceptable, in words for the person typing — or null when
 * it is fine (or blank: "required" is the form's own rule, not this one's).
 */
export function pulaAmountError(pula: string, opts: { positive?: boolean } = {}): string | null {
  const t = pula.trim();
  // (R6 item 20) A payment, refund or cost of P0 is well-formed but moves nothing; the
  // button stayed grey with no reason given. `positive` boxes say so.
  if (opts.positive && PULA_AMOUNT.test(t) && pulaToThebe(t) === 0) return 'Enter more than P0.00';
  if (t === '' || PULA_AMOUNT.test(t)) return null;
  // "10,5" / "10,50": a decimal comma. The dangerous one — it used to read as P105.
  if (/^\d+,\d{1,2}$/.test(t)) return 'Use a dot for decimals, e.g. 10.50';
  // "1,250" / "1,250.50" / "1 250": thousands separators.
  if (/^\d{1,3}([, ']\d{3})+(\.\d{1,2})?$/.test(t)) return 'Leave out thousands separators, e.g. 1250.50';
  if (t.includes(',')) return 'Use a dot for decimals and no thousands separators, e.g. 10.50';
  if (/^\d+\.\d{3,}$/.test(t)) return 'Amounts can have at most two decimal places, e.g. 10.50';
  if (t.startsWith('-')) return 'The amount can’t be negative';
  return 'Enter an amount in Pula, e.g. 10.50';
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
