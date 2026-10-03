--
-- (P6) The Files library — one place for every document.
--
-- Most files already belong to something (a booking's ID copy, an invoice receipt, a repair
-- photo…), and the library derives their category from that link at read time, so it can
-- never drift from where the file is actually used. Two things are new:
--
-- 1. files.category — only for documents uploaded straight into the library that belong to
--    no record: CONTRACTS (landlord agreements, leases, suppliers), COMPLIANCE (licence,
--    insurance, BURS, fire certificates) or OTHER. NULL for everything else.
-- 2. files.property_id — optional: which property a standalone document is about.
--
-- 3. files.guest_documents.read — guest ID / passport copies are personal data. The owner
--    decided (2026-10-03) they are visible to admin and front desk (reception) only, even
--    though other roles hold files.read. Admin keeps every permission by convention.

ALTER TABLE files
  ADD COLUMN category text CHECK (category IN ('CONTRACTS', 'COMPLIANCE', 'OTHER')),
  ADD COLUMN property_id uuid REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX files_live_created_idx ON files(created_at DESC) WHERE deleted_at IS NULL;

INSERT INTO permissions (name, module) VALUES ('files.guest_documents.read', 'files')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'files.guest_documents.read'
  WHERE r.name IN ('admin', 'reception')
ON CONFLICT DO NOTHING;
