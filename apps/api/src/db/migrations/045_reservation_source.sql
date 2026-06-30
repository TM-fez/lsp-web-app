-- Reservation source / channel: where a booking originated.
--
-- Until now the only way to tell a website booking apart was a fragile string
-- match on the notes ("notes LIKE 'Website booking%'"), which the cockpit relied
-- on. This records the origin as real data so the cockpit can flag online
-- bookings reliably and the dashboards get a clean "direct vs OTA" split.

CREATE TYPE reservation_source AS ENUM (
  'WEBSITE',    -- the public /stay page (direct online)
  'WALK_IN',
  'PHONE',
  'EMAIL',
  'OTA',        -- a channel: Booking.com / Airbnb …
  'CORPORATE',
  'OTHER'
);

-- New column. Existing rows default to OTHER (origin unknown), then the website
-- ones are reclassified from their note so the data matches reality on day one.
ALTER TABLE reservations
  ADD COLUMN source reservation_source NOT NULL DEFAULT 'OTHER';

UPDATE reservations
  SET source = 'WEBSITE'
  WHERE notes ILIKE 'Website booking%';

-- Reporting filters by source over active rows (direct-vs-OTA, channel mix).
CREATE INDEX reservations_source_idx ON reservations(source) WHERE deleted_at IS NULL;
