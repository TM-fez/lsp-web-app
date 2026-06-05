CREATE TYPE reservation_status AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');

CREATE TABLE reservations (
  id             UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     UUID               NOT NULL REFERENCES contacts(id),
  -- room_id has no FK yet: the Rooms module is a later sprint. The foreign key
  -- to rooms(id) should be added when that table exists.
  room_id        UUID               NOT NULL,
  check_in_date  DATE               NOT NULL,
  check_out_date DATE               NOT NULL,
  status         reservation_status NOT NULL DEFAULT 'PENDING',
  notes          TEXT,
  created_by     UUID               NOT NULL REFERENCES users(id),
  updated_by     UUID               NOT NULL REFERENCES users(id),
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID               REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  CONSTRAINT reservations_date_order CHECK (check_out_date > check_in_date)
);

-- availability / overlap lookups filter by room and date range over active rows
CREATE INDEX reservations_room_dates_idx
  ON reservations(room_id, check_in_date, check_out_date)
  WHERE deleted_at IS NULL;

-- filter reservations belonging to a contact
CREATE INDEX reservations_contact_idx ON reservations(contact_id) WHERE deleted_at IS NULL;

-- trigram index for case-insensitive search on notes
CREATE INDEX reservations_notes_trgm_idx ON reservations USING gin(notes gin_trgm_ops);

-- partial index: active reservations only (deleted_at IS NULL is the hot path)
CREATE INDEX reservations_active_idx ON reservations(created_at DESC) WHERE deleted_at IS NULL;
