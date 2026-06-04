CREATE TABLE feature_flags (
  key         VARCHAR(100) PRIMARY KEY,
  enabled     BOOLEAN      NOT NULL DEFAULT FALSE,
  rollout_pct SMALLINT     NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  description TEXT,
  metadata    JSONB        NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
