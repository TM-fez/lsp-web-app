-- (Re-test round 3, 2026-10-04) A live hold no longer locks a unit for every date.
--
-- Migration 032 allowed at most ONE live (HELD) hold per unit — whatever its dates — so a
-- booking in flight could not be double-held. Since D01 (2026-09-01) the booking itself
-- holds the unit: a PENDING reservation blocks its dates through `reservations_no_overlap`,
-- the real date-aware guard. For holds that belong to a booking the old per-unit rule only
-- did harm: a hold left live by the cockpit wizard on one booking stopped any OTHER booking
-- of the same unit, on other dates, from opening its own hold — and stopped the desk from
-- taking the money ("pay after the stay" failed with a raw duplicate-key error, #110).
--
-- Keep the rule only for holds with no booking behind them (a bare quote hold), where it
-- is still the only thing stopping two people holding the same unit.

DROP INDEX IF EXISTS holds_active_room_unique;

CREATE UNIQUE INDEX holds_active_room_unique
  ON holds(room_id) WHERE status = 'HELD' AND deleted_at IS NULL AND reservation_id IS NULL;
