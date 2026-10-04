-- (R5 owner decision, 2026-10-04) A booking-less hold reserves its own DATES, not the
-- whole unit.
--
-- Migration 079 kept "one live booking-less hold per unit, whatever the dates"
-- (holds_active_room_unique). That was the only guard a bare quote hold had, but it was
-- blunter than it needed to be: a quote for 1–3 March held the unit against a quote for
-- 20–25 March, so the desk could not work two enquiries for the same unit at once.
--
-- The decision: a hold blocks only the nights its quote covers, exactly like a booking
-- (half-open `[)`, so one quote's check-out day can be the next one's check-in). The
-- dates live on the quote, so they are copied onto the hold — an exclusion constraint can
-- only look at its own row — and kept in step by a trigger, so no caller can forget.
-- A hold with no dates (none should exist) gets an unbounded range: it still blocks the
-- whole unit, which is the safe direction.

ALTER TABLE holds
  ADD COLUMN check_in_date  DATE,
  ADD COLUMN check_out_date DATE;

UPDATE holds h
   SET check_in_date = q.check_in_date, check_out_date = q.check_out_date
  FROM quotes q
 WHERE q.id = h.quote_id;

CREATE OR REPLACE FUNCTION holds_copy_quote_dates() RETURNS trigger AS $$
BEGIN
  SELECT q.check_in_date, q.check_out_date
    INTO NEW.check_in_date, NEW.check_out_date
    FROM quotes q
   WHERE q.id = NEW.quote_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER holds_copy_quote_dates
  BEFORE INSERT OR UPDATE OF quote_id ON holds
  FOR EACH ROW EXECUTE FUNCTION holds_copy_quote_dates();

DROP INDEX IF EXISTS holds_active_room_unique;

-- btree_gist is already installed (migration 035).
ALTER TABLE holds
  ADD CONSTRAINT holds_active_room_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(check_in_date, check_out_date, '[)') WITH &&
  ) WHERE (status = 'HELD' AND deleted_at IS NULL AND reservation_id IS NULL AND room_id IS NOT NULL);
