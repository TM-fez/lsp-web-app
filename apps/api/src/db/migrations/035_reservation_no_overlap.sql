-- No double-bookings, enforced by the database itself.
--
-- Until now "is this unit free?" was a check-then-insert in app code: two requests
-- arriving in the same instant could both pass the check and both insert. This adds
-- a hard guarantee at the storage layer.
--
-- btree_gist lets a single EXCLUDE constraint combine an equality (same room) with a
-- range overlap (overlapping stay dates). daterange is '[)' — inclusive check-in,
-- exclusive check-out — so a same-day turnover (one guest's check-out == the next's
-- check-in) is allowed, matching hotel reality and the existing availability check.
--
-- Only ACTIVE, non-deleted reservations participate: CANCELLED / CHECKED_OUT (and
-- soft-deleted) rows never block a new booking. Verified 0 existing overlaps before
-- adding this constraint.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE reservations
  ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(check_in_date, check_out_date) WITH &&
  )
  WHERE (status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN') AND deleted_at IS NULL);
