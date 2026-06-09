import { sql } from 'kysely';

/**
 * The property operates in Gaborone, Botswana (UTC+2, no daylight saving). "Today"
 * must be anchored to that wall clock everywhere — not the server's UTC clock — or
 * the cockpit's arrivals/departures and the past-date guard drift by a day around
 * midnight (a guest booking just after midnight in Gaborone would be judged against
 * the previous UTC day).
 */
export const PROPERTY_TIMEZONE = 'Africa/Gaborone';

/** Today's calendar date in the property's timezone, as 'YYYY-MM-DD'. */
export function todayInPropertyTZ(now: Date = new Date()): string {
  // 'en-CA' renders dates as YYYY-MM-DD; timeZone pins it to the property's local day.
  return new Intl.DateTimeFormat('en-CA', { timeZone: PROPERTY_TIMEZONE }).format(now);
}

/** SQL fragment: "today" as a date in the property's timezone (for date-column comparisons). */
export function propertyToday() {
  return sql<Date>`(now() AT TIME ZONE ${PROPERTY_TIMEZONE})::date`;
}
