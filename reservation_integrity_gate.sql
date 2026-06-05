-- =============================================================================
-- reservation_integrity_gate.sql
-- -----------------------------------------------------------------------------
-- Sprint 8 — Reservation Integrity readiness gate (READ ONLY).
--
-- Purpose:
--   Decide whether the DB-owned booking invariant (EXCLUDE USING gist + room_id
--   FK) can be added safely, by gathering evidence against REAL reservation data.
--
-- Produces, in order:
--   1. extension_readiness   — pgcrypto / pg_trgm / btree_gist + CREATE privilege
--   2. overlap_count         — number of overlapping live reservation pairs
--   3. overlap_detail        — the exact colliding pairs and overlap windows
--   4. orphan_count          — reservations.room_id with no / soft-deleted room
--   5. orphan_detail         — the offending rows
--   6. blocker_consistency   — data-driven divergence between blocking definitions
--   7. final_gate            — single READY / BLOCKED verdict row
--
-- Safety:
--   * SELECT-only. No DDL, no INSERT/UPDATE/DELETE, no CREATE/ALTER/DROP.
--   * Wrapped in a READ ONLY transaction and ROLLBACK — any accidental write
--     aborts; nothing is persisted.
--
-- Requirements:
--   * PostgreSQL 13+ (uses pg_available_extension_versions.trusted).
--   * Run against a MIGRATED database that holds the real reservations
--     (production snapshot / staging clone). A fresh empty DB returns trivial
--     zeros and is NOT valid evidence for the gate.
--
-- Run:
--   psql "$DATABASE_URL" -f reservation_integrity_gate.sql
-- =============================================================================

BEGIN;
SET TRANSACTION READ ONLY;

-- -----------------------------------------------------------------------------
-- 1. EXTENSION READINESS
--    Is the gating extension (btree_gist) installed, available, and creatable
--    by the current role? pgcrypto/pg_trgm are pre-existing dependencies.
-- -----------------------------------------------------------------------------
SELECT
  'extension_readiness'                                                   AS section,
  current_database()                                                      AS database,
  current_user                                                            AS role,
  COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
                                                                          AS is_superuser,
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto')           AS pgcrypto_installed,
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')            AS pg_trgm_installed,
  EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist')         AS btree_gist_installed,
  EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') AS btree_gist_available,
  COALESCE((SELECT bool_or(trusted) FROM pg_available_extension_versions
            WHERE name = 'btree_gist'), false)                            AS btree_gist_trusted,
  has_database_privilege(current_user, current_database(), 'CREATE')       AS has_db_create_priv,
  (
    COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
    OR (
      COALESCE((SELECT bool_or(trusted) FROM pg_available_extension_versions
                WHERE name = 'btree_gist'), false)
      AND has_database_privilege(current_user, current_database(), 'CREATE')
    )
  )                                                                       AS can_create_btree_gist;

-- -----------------------------------------------------------------------------
-- 2. OVERLAP COUNT
--    Live reservation pairs on the same room whose [check_in, check_out) ranges
--    overlap. Ignores soft-deleted rows, CANCELLED, and CHECKED_OUT.
--    MUST be 0 before an EXCLUDE constraint can be added.
-- -----------------------------------------------------------------------------
SELECT
  'overlap_count' AS section,
  count(*)        AS overlap_pairs
FROM reservations a
JOIN reservations b
  ON  a.room_id = b.room_id
  AND a.id < b.id
WHERE a.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND a.status NOT IN ('CANCELLED','CHECKED_OUT')
  AND b.status NOT IN ('CANCELLED','CHECKED_OUT')
  AND daterange(a.check_in_date, a.check_out_date, '[)')
   && daterange(b.check_in_date, b.check_out_date, '[)');

-- -----------------------------------------------------------------------------
-- 3. OVERLAP DETAIL
--    The exact colliding pairs, both ranges, and the intersecting window.
--    Empty result set == no collisions.
-- -----------------------------------------------------------------------------
SELECT
  'overlap_detail'                                            AS section,
  a.room_id                                                   AS room_id,
  a.id            AS reservation_a, a.status AS status_a,
  b.id            AS reservation_b, b.status AS status_b,
  daterange(a.check_in_date, a.check_out_date, '[)')          AS range_a,
  daterange(b.check_in_date, b.check_out_date, '[)')          AS range_b,
  daterange(a.check_in_date, a.check_out_date, '[)')
    * daterange(b.check_in_date, b.check_out_date, '[)')      AS overlap_window
FROM reservations a
JOIN reservations b
  ON  a.room_id = b.room_id
  AND a.id < b.id
WHERE a.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND a.status NOT IN ('CANCELLED','CHECKED_OUT')
  AND b.status NOT IN ('CANCELLED','CHECKED_OUT')
  AND daterange(a.check_in_date, a.check_out_date, '[)')
   && daterange(b.check_in_date, b.check_out_date, '[)')
ORDER BY a.room_id, a.check_in_date, b.check_in_date;

-- -----------------------------------------------------------------------------
-- 4. ORPHAN COUNT
--    hard_orphans              -> room_id with no matching room   (BLOCKS the FK)
--    refs_to_soft_deleted_rooms-> room exists but is soft-deleted (quality flag)
-- -----------------------------------------------------------------------------
SELECT
  'orphan_count' AS section,
  (SELECT count(*) FROM reservations r
     LEFT JOIN rooms rm ON rm.id = r.room_id
   WHERE rm.id IS NULL)                                AS hard_orphans,
  (SELECT count(*) FROM reservations r
     JOIN rooms rm ON rm.id = r.room_id
   WHERE rm.deleted_at IS NOT NULL)                    AS refs_to_soft_deleted_rooms;

-- -----------------------------------------------------------------------------
-- 5. ORPHAN DETAIL
--    HARD_MISSING_ROOM  -> blocks the FK; must be reassigned/removed first.
--    ROOM_SOFT_DELETED  -> FK passes; data-quality / policy concern.
-- -----------------------------------------------------------------------------
SELECT
  'orphan_detail'      AS section,
  'HARD_MISSING_ROOM'  AS kind,
  r.id                 AS reservation_id,
  r.room_id            AS room_id,
  r.status             AS status,
  r.check_in_date      AS check_in_date,
  r.check_out_date     AS check_out_date,
  r.created_at         AS created_at
FROM reservations r
LEFT JOIN rooms rm ON rm.id = r.room_id
WHERE rm.id IS NULL
UNION ALL
SELECT
  'orphan_detail'      AS section,
  'ROOM_SOFT_DELETED'  AS kind,
  r.id,
  r.room_id,
  r.status,
  r.check_in_date,
  r.check_out_date,
  r.created_at
FROM reservations r
JOIN rooms rm ON rm.id = r.room_id
WHERE rm.deleted_at IS NOT NULL
ORDER BY 2 ASC, 8 DESC;

-- -----------------------------------------------------------------------------
-- 6. BLOCKER CONSISTENCY SUMMARY
--    Quantifies the divergence between the two booking-layer definitions of
--    "blocked", using live data:
--      * Reservation.checkAvailability blocks PENDING + CONFIRMED + CHECKED_IN
--      * Availability engine counts only CONFIRMED as "reserved"
--    divergence_rows = rows the reservation rule treats as blocking but the
--    availability rule does not (the "looked free, got 409" surface).
--    pending_rows is the cleanest UI-divergent case (canonical fix: PENDING blocks).
-- -----------------------------------------------------------------------------
SELECT
  'blocker_consistency' AS section,
  count(*) FILTER (WHERE status = 'PENDING')      AS pending_rows,
  count(*) FILTER (WHERE status = 'CONFIRMED')    AS confirmed_rows,
  count(*) FILTER (WHERE status = 'CHECKED_IN')   AS checked_in_rows,
  count(*) FILTER (WHERE status = 'CHECKED_OUT')  AS checked_out_rows,
  count(*) FILTER (WHERE status = 'CANCELLED')    AS cancelled_rows,
  count(*) FILTER (WHERE status IN ('PENDING','CONFIRMED','CHECKED_IN'))
                                                  AS blocks_reservation_rule,
  count(*) FILTER (WHERE status = 'CONFIRMED')    AS blocks_availability_rule,
  count(*) FILTER (WHERE status IN ('PENDING','CHECKED_IN'))
                                                  AS divergence_rows
FROM reservations
WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 7. FINAL GATE
--    READY only if: pgcrypto present, pg_trgm present, btree_gist creatable,
--    overlap_pairs = 0, hard_orphans = 0.
--    (The canonical blocking-definition policy decision — "PENDING blocks" — is
--     a human decision, external to SQL; noted below.)
-- -----------------------------------------------------------------------------
SELECT
  'final_gate'                       AS section,
  ext.pgcrypto_installed             AS pgcrypto_ok,
  ext.pg_trgm_installed              AS pg_trgm_ok,
  ext.can_create_btree_gist          AS btree_gist_ok,
  ovl.overlap_pairs                  AS overlap_pairs,
  orp.hard_orphans                   AS hard_orphans,
  orp.refs_to_soft_deleted_rooms     AS refs_to_soft_deleted_rooms,
  CASE
    WHEN ext.pgcrypto_installed
     AND ext.pg_trgm_installed
     AND ext.can_create_btree_gist
     AND ovl.overlap_pairs = 0
     AND orp.hard_orphans  = 0
    THEN 'READY'
    ELSE 'BLOCKED'
  END                                AS gate_status,
  NULLIF(concat_ws('; ',
    CASE WHEN NOT ext.pgcrypto_installed    THEN 'pgcrypto missing' END,
    CASE WHEN NOT ext.pg_trgm_installed     THEN 'pg_trgm missing' END,
    CASE WHEN NOT ext.can_create_btree_gist THEN 'btree_gist not creatable (privilege/availability)' END,
    CASE WHEN ovl.overlap_pairs > 0         THEN ovl.overlap_pairs || ' overlapping pair(s)' END,
    CASE WHEN orp.hard_orphans  > 0         THEN orp.hard_orphans  || ' hard orphan(s)' END
  ), '')                             AS block_reasons,
  'Canonical policy (PENDING blocks) is a human decision, external to this gate'
                                     AS note
FROM
  (SELECT
     EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS pgcrypto_installed,
     EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')  AS pg_trgm_installed,
     (
       COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
       OR (
         COALESCE((SELECT bool_or(trusted) FROM pg_available_extension_versions
                   WHERE name = 'btree_gist'), false)
         AND has_database_privilege(current_user, current_database(), 'CREATE')
       )
     ) AS can_create_btree_gist
  ) ext,
  (SELECT count(*) AS overlap_pairs
     FROM reservations a
     JOIN reservations b
       ON a.room_id = b.room_id AND a.id < b.id
     WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
       AND a.status NOT IN ('CANCELLED','CHECKED_OUT')
       AND b.status NOT IN ('CANCELLED','CHECKED_OUT')
       AND daterange(a.check_in_date, a.check_out_date, '[)')
        && daterange(b.check_in_date, b.check_out_date, '[)')
  ) ovl,
  (SELECT
     (SELECT count(*) FROM reservations r
        LEFT JOIN rooms rm ON rm.id = r.room_id WHERE rm.id IS NULL)        AS hard_orphans,
     (SELECT count(*) FROM reservations r
        JOIN rooms rm ON rm.id = r.room_id WHERE rm.deleted_at IS NOT NULL) AS refs_to_soft_deleted_rooms
  ) orp;

ROLLBACK;
-- =============================================================================
-- End of gate. Nothing was written. Re-run after any data remediation.
-- =============================================================================
