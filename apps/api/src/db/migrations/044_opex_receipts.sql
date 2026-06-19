-- Phase 2 extras: attach a receipt file to an operating cost. Receipts use the
-- existing Files platform; Accounts manages costs but lacked file perms, so grant
-- them here.

ALTER TABLE operating_expenses
  ADD COLUMN receipt_file_id UUID REFERENCES files(id) ON DELETE SET NULL;

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('files.read', 'files.create')
  WHERE r.name = 'accounts'
ON CONFLICT DO NOTHING;
