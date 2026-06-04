CREATE TABLE audit_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID,
  user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(20) NOT NULL,
  entity     VARCHAR(50) NOT NULL,
  entity_id  TEXT        NOT NULL,
  diff       JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_entity_idx    ON audit_logs(entity, entity_id);
CREATE INDEX audit_logs_user_idx      ON audit_logs(user_id);
CREATE INDEX audit_logs_request_idx   ON audit_logs(request_id);
CREATE INDEX audit_logs_created_idx   ON audit_logs(created_at DESC);
