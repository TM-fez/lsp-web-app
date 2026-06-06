-- Sprint 8 — Commercial Core: Reservation hold engine.
-- A hold is a temporary, money-backed claim derived from a quote. Holds protect
-- occupancy until a payment confirms them; `held_until` drives smart/auto release.
-- retry_count records payment-retry-before-release activity.

CREATE TYPE hold_status AS ENUM ('HELD', 'CONFIRMED', 'EXPIRED', 'RELEASED');

CREATE TABLE holds (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id       UUID        NOT NULL REFERENCES quotes(id),
  reservation_id UUID        REFERENCES reservations(id) ON DELETE SET NULL,
  room_id        UUID        REFERENCES rooms(id) ON DELETE SET NULL,
  status         hold_status NOT NULL DEFAULT 'HELD',
  held_until     TIMESTAMPTZ NOT NULL,
  retry_count    INTEGER     NOT NULL DEFAULT 0,
  release_reason TEXT,
  created_by     UUID        NOT NULL REFERENCES users(id),
  updated_by     UUID        NOT NULL REFERENCES users(id),
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT holds_retry_nonneg CHECK (retry_count >= 0)
);

-- A quote yields at most one live hold.
CREATE UNIQUE INDEX holds_active_quote_unique
  ON holds(quote_id) WHERE status IN ('HELD', 'CONFIRMED') AND deleted_at IS NULL;

-- Auto-release sweep: find expiring active holds quickly.
CREATE INDEX holds_active_until_idx
  ON holds(held_until) WHERE status = 'HELD' AND deleted_at IS NULL;

CREATE INDEX holds_status_idx ON holds(status) WHERE deleted_at IS NULL;
