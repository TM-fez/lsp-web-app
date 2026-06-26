// Channel sync (LSP ↔ Booking.com via iCal) — shared constants for both directions.

// Nights we PUBLISH to OTAs: this unit's own direct-sold stays. Deliberately excludes
// PENDING — an unpaid hold should not block OTA inventory (it would over-block and lose
// sales if the hold later expires). To also block on holds, add 'PENDING' here.
export const EXPORTABLE_STATUSES = ['CONFIRMED', 'CHECKED_IN'] as const;

// Only OUR OWN bookings get published. BOOKING_COM-sourced rows are excluded so an OTA's
// own booking is never echoed back to it — that feedback loop is the one bug we cannot
// ship (proven by channel-export.test.ts). 'WEBSITE' = a /stay booking; still ours.
export const EXPORT_SOURCES = ['DIRECT', 'WEBSITE'] as const;

// Stable, globally-unique VEVENT id for one of our reservations. Stable across re-exports
// so subscribers update the same event rather than duplicating it.
export const icalUid = (reservationId: string): string => `${reservationId}@lsp.lifestyle`;

// All an OTA-readable feed is allowed to reveal about an occupied night. Never a guest
// name or any PII — the feed URL is effectively public to whoever holds the token.
export const BUSY_SUMMARY = 'Not available';

// ── Import side (Booking.com → LSP) ──────────────────────────────────────────────
// Imported OTA bookings are stored as BLOCKED reservations, but reservations.contact_id
// and created_by are NOT NULL and an OTA guest is not an LSP CRM contact. So the importer
// attributes every imported block to these seeded system actors (migration 047): a
// non-login service user and a synthetic "Booking.com (imported)" contact. Fixed ids so
// the code can reference them as constants without a lookup.
export const SYSTEM_USER_ID = '00000000-0000-4000-a000-000000000001';
export const SYSTEM_OTA_CONTACT_ID = '00000000-0000-4000-a000-000000000002';

// Provenance + status stamped on every imported night.
export const IMPORT_SOURCE = 'BOOKING_COM' as const;
export const IMPORT_STATUS = 'BLOCKED' as const;
