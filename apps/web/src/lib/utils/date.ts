// The property runs on Gaborone time (UTC+2, no daylight saving). "Today" in the UI
// must mean the property's day, not the browser's — otherwise a staff member working
// just after midnight (or a travelling / misconfigured laptop) sees yesterday's date,
// which then mis-defaults booking dates and the date-picker's `min`.
export const PROPERTY_TIMEZONE = 'Africa/Gaborone';

/** 'YYYY-MM-DD' for today (plus an optional whole-day offset) in the property's timezone. */
export function todayISO(offsetDays = 0): string {
  // 'en-CA' renders as YYYY-MM-DD; timeZone pins it to the property's local day.
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: PROPERTY_TIMEZONE }).format(new Date());
  if (offsetDays === 0) return todayStr;
  // Apply the offset on a UTC date built from the property's Y-M-D, so it can never
  // drift across the browser's own midnight.
  const [y, m, d] = todayStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d));
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Postgres `date` columns serialize as ISO timestamps (`2026-08-21T00:00:00.000Z`)
 * once they leave node-pg. Slice the calendar day off the front — do not parse
 * with `new Date()`, which would shift the day west of Gaborone.
 */
export function calendarDay(iso: string): string {
  return iso.slice(0, 10);
}

/** Compact `MM-DD` for the cockpit rail and unit tiles. */
export function shortDay(iso: string): string {
  const day = calendarDay(iso);
  const md = day.slice(5);
  return /^\d{2}-\d{2}$/.test(md) ? md : day;
}
