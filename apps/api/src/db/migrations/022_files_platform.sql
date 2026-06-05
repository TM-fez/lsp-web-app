-- Rename existing columns to match new schema
ALTER TABLE files RENAME COLUMN driver TO storage_driver;
ALTER TABLE files RENAME COLUMN uploaded_by TO created_by;
ALTER TABLE files RENAME COLUMN key TO path;

-- Add new columns
ALTER TABLE files
  ADD COLUMN original_name TEXT,
  ADD COLUMN stored_name TEXT,
  ADD COLUMN extension TEXT,
  ADD COLUMN checksum TEXT,
  ADD COLUMN is_public BOOLEAN DEFAULT false,
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by UUID REFERENCES users(id),
  ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill data for any existing records
UPDATE files SET 
  original_name = 'unknown',
  stored_name = path,
  extension = 'bin',
  checksum = 'unknown',
  is_public = false;

-- Enforce constraints
ALTER TABLE files
  ALTER COLUMN original_name SET NOT NULL,
  ALTER COLUMN stored_name SET NOT NULL,
  ALTER COLUMN extension SET NOT NULL,
  ALTER COLUMN checksum SET NOT NULL,
  ALTER COLUMN is_public SET NOT NULL;

-- Indexes
CREATE INDEX idx_files_mime_type ON files(mime_type);
CREATE INDEX idx_files_created_by ON files(created_by);
CREATE INDEX idx_files_deleted_at ON files(deleted_at);
CREATE INDEX idx_files_checksum ON files(checksum);

-- Checks
ALTER TABLE files ADD CONSTRAINT files_size_bytes_check CHECK (size_bytes > 0);

-- Entity Integrations
ALTER TABLE rooms ADD COLUMN image_file_id UUID REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE reservations ADD COLUMN document_file_id UUID REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE occupancy ADD COLUMN document_file_id UUID REFERENCES files(id) ON DELETE SET NULL;
