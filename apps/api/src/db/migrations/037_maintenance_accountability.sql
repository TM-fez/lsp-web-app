-- Maintenance accountability: who DID the repair and who APPROVED it.
--
-- assigned_to + reported_by already exist. This adds:
--   completed_by  — the staff member who marked it fixed
--   approved_by / approved_at — a management sign-off on a COMPLETED order
-- and a maintenance.approve permission so approval is a separate, higher bar than
-- completion (a technician does the work; a manager signs it off — separation of duties).

ALTER TABLE maintenance_work_orders
  ADD COLUMN completed_by UUID REFERENCES users(id),
  ADD COLUMN approved_by  UUID REFERENCES users(id),
  ADD COLUMN approved_at  TIMESTAMPTZ;

INSERT INTO permissions (name, module) VALUES
  ('maintenance.approve', 'maintenance')
ON CONFLICT (name) DO NOTHING;

-- Management approves completed repairs (the maintenance role does the work but
-- does not sign off its own — that's the point of the approval step).
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'maintenance.approve'
  WHERE r.name IN ('admin', 'operations')
ON CONFLICT DO NOTHING;
