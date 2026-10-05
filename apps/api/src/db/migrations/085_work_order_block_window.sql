-- (R5 owner decision, 2026-10-04) A serious repair can block just its own dates.
--
-- Since re-test round 3 an open HIGH / CRITICAL work order puts its unit under
-- MAINTENANCE, and MAINTENANCE blocks EVERY date — the only safe reading of a flag that
-- has no end date. That turned "the geyser is booked for replacement on the 14th" into a
-- unit nobody could book for next month either.
--
-- The decision: a serious repair may carry the nights it takes the unit out of use
-- (`blocks_from` .. `blocks_to`, half-open `[)` like a booking). With dates, only those
-- nights are blocked — availability, the booking check and the public site all read the
-- window — and the unit's status is left alone. Without dates nothing changes: the unit
-- is under MAINTENANCE for every date until the job is closed, which is the safe default
-- when nobody knows how long it will take.

ALTER TABLE maintenance_work_orders
  ADD COLUMN blocks_from DATE,
  ADD COLUMN blocks_to   DATE,
  ADD CONSTRAINT maintenance_block_window_valid CHECK (
    (blocks_from IS NULL AND blocks_to IS NULL)
    OR (blocks_from IS NOT NULL AND blocks_to IS NOT NULL AND blocks_to > blocks_from)
  );

-- Availability asks "does any live window on this unit overlap these nights?".
CREATE INDEX maintenance_block_window_idx
  ON maintenance_work_orders (room_id, blocks_from, blocks_to)
  WHERE blocks_from IS NOT NULL AND deleted_at IS NULL;
