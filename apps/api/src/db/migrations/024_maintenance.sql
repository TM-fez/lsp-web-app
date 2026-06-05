CREATE TYPE maintenance_status AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');
CREATE TYPE maintenance_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE maintenance_work_orders (
  id             UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        UUID                 NOT NULL REFERENCES rooms(id),
  title          VARCHAR(255)         NOT NULL,
  description    TEXT,
  status         maintenance_status   NOT NULL DEFAULT 'OPEN',
  priority       maintenance_priority NOT NULL DEFAULT 'MEDIUM',
  reported_by    UUID                 NOT NULL REFERENCES users(id),
  assigned_to    UUID                 REFERENCES users(id) ON DELETE SET NULL,
  before_file_id UUID                 REFERENCES files(id) ON DELETE SET NULL,
  after_file_id  UUID                 REFERENCES files(id) ON DELETE SET NULL,
  opened_at      TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  cancelled_at   TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID                 REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  CONSTRAINT maintenance_dates_check CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX maintenance_work_orders_room_id_idx ON maintenance_work_orders(room_id) WHERE deleted_at IS NULL;
CREATE INDEX maintenance_work_orders_status_idx ON maintenance_work_orders(status) WHERE deleted_at IS NULL;
CREATE INDEX maintenance_work_orders_assigned_to_idx ON maintenance_work_orders(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX maintenance_work_orders_deleted_at_idx ON maintenance_work_orders(deleted_at);
