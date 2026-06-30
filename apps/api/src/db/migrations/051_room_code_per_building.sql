-- Per-property apartment naming.
--
-- 016 made a unit code globally unique. With multi-property that's wrong: two
-- properties (or two blocks within one) should each be able to have a "101".
-- Scope uniqueness to the building (block) instead — which also keeps codes from
-- clashing across properties, since a building belongs to exactly one property.
--
-- Existing codes are globally unique today, so they already satisfy the narrower
-- per-building rule — this re-index can't violate.

DROP INDEX IF EXISTS rooms_code_active_unique;

CREATE UNIQUE INDEX rooms_code_per_building_unique
  ON rooms (building_id, lower(code))
  WHERE deleted_at IS NULL;
