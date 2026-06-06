-- Sprint 9 — Operations Cockpit: Housekeeping readiness.
-- Readiness is a dimension ORTHOGONAL to operational room status: a unit can be
-- AVAILABLE yet not READY (just vacated, awaiting turn). A unit is bookable /
-- assignable / check-in-able only when status = 'AVAILABLE' AND
-- housekeeping_status = 'READY'. Check-out sets a unit DIRTY and opens a task;
-- the housekeeping workflow drives it back DIRTY -> CLEANING -> INSPECTED -> READY.

CREATE TYPE housekeeping_status      AS ENUM ('READY', 'DIRTY', 'CLEANING', 'INSPECTED');
CREATE TYPE housekeeping_task_status AS ENUM ('OPEN', 'CLEANING', 'INSPECTED', 'DONE');

-- Readiness dimension on the unit (denormalized for fast board rendering).
ALTER TABLE rooms
  ADD COLUMN housekeeping_status housekeeping_status NOT NULL DEFAULT 'READY';

CREATE INDEX rooms_housekeeping_status_idx
  ON rooms(housekeeping_status) WHERE deleted_at IS NULL;

-- The cleaning queue: one live task per unit needing a turn.
CREATE TABLE housekeeping_tasks (
  id           UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID                     NOT NULL REFERENCES rooms(id),
  occupancy_id UUID                     REFERENCES occupancy(id) ON DELETE SET NULL,
  status       housekeeping_task_status NOT NULL DEFAULT 'OPEN',
  assigned_to  UUID                     REFERENCES users(id) ON DELETE SET NULL,
  notes        TEXT,
  opened_at    TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  inspected_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by   UUID                     NOT NULL REFERENCES users(id),
  updated_by   UUID                     NOT NULL REFERENCES users(id),
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID                     REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

CREATE INDEX housekeeping_tasks_room_id_idx ON housekeeping_tasks(room_id) WHERE deleted_at IS NULL;
CREATE INDEX housekeeping_tasks_status_idx  ON housekeeping_tasks(status)  WHERE deleted_at IS NULL;
CREATE INDEX housekeeping_tasks_assigned_idx ON housekeeping_tasks(assigned_to) WHERE deleted_at IS NULL;

-- At most one live (not-yet-done) task per unit — check-out is idempotent.
CREATE UNIQUE INDEX housekeeping_tasks_one_live_per_room
  ON housekeeping_tasks(room_id) WHERE status <> 'DONE' AND deleted_at IS NULL;

-- Hardening (A1): a unit can carry at most one live HELD hold, so a booking in
-- flight cannot be double-held. (The pre-existing holds_active_quote_unique only
-- dedupes per-quote.) Confirmed holds are intentionally excluded — they hand off
-- to the reservation/occupancy layer and persist past check-out.
CREATE UNIQUE INDEX holds_active_room_unique
  ON holds(room_id) WHERE status = 'HELD' AND deleted_at IS NULL;
