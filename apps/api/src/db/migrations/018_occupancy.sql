CREATE TYPE occupancy_status AS ENUM ('CHECKED_IN', 'CHECKED_OUT');

CREATE TABLE occupancy (
  id             UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID             NOT NULL REFERENCES reservations(id),
  room_id        UUID             NOT NULL REFERENCES rooms(id),
  status         occupancy_status NOT NULL DEFAULT 'CHECKED_IN',
  checked_in_at  TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  checked_out_at TIMESTAMPTZ,
  guest_count    INTEGER          NOT NULL DEFAULT 1,
  notes          TEXT,
  created_by     UUID             NOT NULL REFERENCES users(id),
  updated_by     UUID             NOT NULL REFERENCES users(id),
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID             REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  CONSTRAINT occupancy_guest_count_positive CHECK (guest_count > 0),
  CONSTRAINT occupancy_checkout_after_checkin CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at)
);

-- Prevent double occupancy: at most one active (CHECKED_IN) record per room
-- and per reservation.
CREATE UNIQUE INDEX occupancy_active_room_unique
  ON occupancy(room_id) WHERE status = 'CHECKED_IN' AND deleted_at IS NULL;
CREATE UNIQUE INDEX occupancy_active_reservation_unique
  ON occupancy(reservation_id) WHERE status = 'CHECKED_IN' AND deleted_at IS NULL;

-- filter by status, active rows only
CREATE INDEX occupancy_status_idx ON occupancy(status) WHERE deleted_at IS NULL;

-- partial index: active occupancy rows (deleted_at IS NULL is the hot path)
CREATE INDEX occupancy_active_idx ON occupancy(created_at DESC) WHERE deleted_at IS NULL;
