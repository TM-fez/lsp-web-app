// Channel sync (LSP ↔ Booking.com via iCal) — shared constants for both directions.

// Nights we PUBLISH to OTAs: this unit's own direct-sold stays.
//
// PENDING is included (defect D01, owner decision 2026-09-01: an unpaid booking holds
// the room). It has a cost, and the cost is deliberate: a hold that later expires
// over-blocks OTA inventory for up to WEBSITE_PENDING_TTL_HOURS and may lose a sale.
// The alternative is worse — if a PENDING night blocks us but reads as free to
// Booking.com, the OTA sells it and we get a real double-booking with a guest at the
// door. Over-blocking loses a booking; under-blocking loses a guest's room.
//
// The window is self-limiting: the expiry sweep cancels unpaid website bookings after
// WEBSITE_PENDING_TTL_HOURS and the next export drops the night again.
export const EXPORTABLE_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN'] as const;

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
