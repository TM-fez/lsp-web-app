CREATE TYPE storage_driver AS ENUM ('local', 's3');

CREATE TABLE files (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by  UUID           NOT NULL REFERENCES users(id),
  driver       storage_driver NOT NULL,
  bucket       TEXT,
  key          TEXT           NOT NULL,
  mime_type    TEXT           NOT NULL,
  size_bytes   BIGINT         NOT NULL,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- deferred FK: users.avatar_file_id → files.id
ALTER TABLE users
  ADD CONSTRAINT users_avatar_file_fk
  FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;
