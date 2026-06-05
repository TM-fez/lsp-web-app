CREATE TYPE lead_status AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST');

CREATE TABLE leads (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  status      lead_status  NOT NULL DEFAULT 'NEW',
  contact_id  UUID         REFERENCES contacts(id) ON DELETE SET NULL,
  created_by  UUID         NOT NULL REFERENCES users(id),
  updated_by  UUID         NOT NULL REFERENCES users(id),
  deleted_at  TIMESTAMPTZ,
  deleted_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- trigram indexes for case-insensitive search (title, description)
CREATE INDEX leads_title_trgm_idx ON leads USING gin(title       gin_trgm_ops);
CREATE INDEX leads_desc_trgm_idx  ON leads USING gin(description gin_trgm_ops);

-- pipeline filtering by status, active rows only
CREATE INDEX leads_status_idx ON leads(status) WHERE deleted_at IS NULL;

-- partial index: active leads only (deleted_at IS NULL is the hot path)
CREATE INDEX leads_active_idx ON leads(created_at DESC) WHERE deleted_at IS NULL;
