-- Unify reservations.source.
--
-- Channel sync (046) introduced reservations.source for the iCal import with a
-- narrow set: DIRECT / WEBSITE / BOOKING_COM. This widens the CHECK so the same
-- column also carries the CRM booking channel (walk-in / phone / email /
-- corporate / other) — one origin field serving both the importer and the
-- "direct vs OTA" reporting, instead of two overlapping columns.
--
-- Default stays DIRECT and external_uid / the OTA-dedup index are untouched.

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_source_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_source_check
  CHECK (source IN ('DIRECT', 'WEBSITE', 'WALK_IN', 'PHONE', 'EMAIL', 'BOOKING_COM', 'CORPORATE', 'OTHER'));
