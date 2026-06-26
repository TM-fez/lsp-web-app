-- Channel sync (direct Booking.com iCal): the columns + the BLOCKED-aware overlap rule.
--
-- Direction of travel (supersedes the old "keep Little Hotelier" plan): LSP is now the
-- channel manager. It EXPORTS one iCal feed per unit (its direct-sold nights) and
-- IMPORTS Booking.com's feed back, landing each OTA booking as a BLOCKED reservation.
-- The BLOCKED status (added in 045) now participates in the no-double-booking guarantee,
-- so an imported OTA night and a direct sale physically cannot both exist on a unit.
--
--   rooms.ical_token         — unguessable secret embedded in each unit's public export URL.
--   rooms.booking_ical_url    — where to PULL that unit's Booking.com calendar from.
--   reservations.source       — DIRECT (staff/manual), WEBSITE (/stay), BOOKING_COM (imported).
--   reservations.external_uid — the VEVENT UID from Booking.com; lets a re-poll upsert the
--                               same booking instead of creating a duplicate block.

ALTER TABLE rooms
  ADD COLUMN ical_token       uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN booking_ical_url  text;

-- Each unit's export URL must be unique and unguessable.
CREATE UNIQUE INDEX rooms_ical_token_unique ON rooms (ical_token);

ALTER TABLE reservations
  ADD COLUMN source       text NOT NULL DEFAULT 'DIRECT'
    CONSTRAINT reservations_source_check CHECK (source IN ('DIRECT', 'WEBSITE', 'BOOKING_COM')),
  ADD COLUMN external_uid text;

-- One row per external booking: re-importing the same Booking.com VEVENT updates the
-- existing block rather than inserting a duplicate. Partial — only OTA rows carry a UID.
CREATE UNIQUE INDEX reservations_source_external_uid_unique
  ON reservations (source, external_uid)
  WHERE external_uid IS NOT NULL;

-- Re-state the no-double-booking guarantee so an imported BLOCKED night now collides
-- with (and is collided by) direct PENDING/CONFIRMED/CHECKED_IN stays. Identical gist /
-- daterange shape as migration 035 — only the status set grows by 'BLOCKED'. Verified 0
-- existing overlaps before 035; BLOCKED rows do not exist yet, so this re-add is safe.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_no_overlap;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(check_in_date, check_out_date) WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'BLOCKED') AND deleted_at IS NULL);
