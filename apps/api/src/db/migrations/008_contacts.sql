CREATE TYPE contact_type AS ENUM ('individual', 'company');

CREATE TABLE contacts (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  type           contact_type NOT NULL DEFAULT 'individual',
  name           VARCHAR(200) NOT NULL,
  email          VARCHAR(255),
  phone          VARCHAR(30),
  company        VARCHAR(200),
  address        TEXT,
  notes          TEXT,
  avatar_file_id UUID         REFERENCES files(id) ON DELETE SET NULL,
  created_by     UUID         NOT NULL REFERENCES users(id),
  updated_by     UUID         NOT NULL REFERENCES users(id),
  deleted_at     TIMESTAMPTZ,
  deleted_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- trigram indexes for full-text search
CREATE INDEX contacts_name_trgm_idx    ON contacts USING gin(name    gin_trgm_ops);
CREATE INDEX contacts_email_trgm_idx   ON contacts USING gin(email   gin_trgm_ops);
CREATE INDEX contacts_company_trgm_idx ON contacts USING gin(company gin_trgm_ops);

-- partial index: active contacts only (deleted_at IS NULL is the hot path)
CREATE INDEX contacts_active_idx ON contacts(created_at DESC) WHERE deleted_at IS NULL;
