CREATE TYPE room_type   AS ENUM ('STANDARD', 'DELUXE', 'SUITE', 'CONFERENCE', 'CUSTOM');
CREATE TYPE room_status AS ENUM ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'OUT_OF_SERVICE');

CREATE TABLE rooms (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  code        VARCHAR(50)  NOT NULL,
  type        room_type    NOT NULL DEFAULT 'STANDARD',
  status      room_status  NOT NULL DEFAULT 'AVAILABLE',
  capacity    INTEGER      NOT NULL DEFAULT 1,
  notes       TEXT,
  created_by  UUID         NOT NULL REFERENCES users(id),
  updated_by  UUID         NOT NULL REFERENCES users(id),
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT rooms_capacity_positive CHECK (capacity > 0)
);

-- unique room code among active rooms (case-insensitive); a code frees up after soft delete
CREATE UNIQUE INDEX rooms_code_active_unique ON rooms (lower(code)) WHERE deleted_at IS NULL;

-- trigram indexes for case-insensitive search (name, code)
CREATE INDEX rooms_name_trgm_idx ON rooms USING gin(name gin_trgm_ops);
CREATE INDEX rooms_code_trgm_idx ON rooms USING gin(code gin_trgm_ops);

-- filter by status, active rows only
CREATE INDEX rooms_status_idx ON rooms(status) WHERE deleted_at IS NULL;

-- partial index: active rooms only (deleted_at IS NULL is the hot path)
CREATE INDEX rooms_active_idx ON rooms(created_at DESC) WHERE deleted_at IS NULL;
