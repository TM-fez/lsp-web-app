-- Forward-only: seed the Check-In/Check-Out permissions guarded by the checkins
-- routes (checkins.{read,create,update}) and grant them to roles.

INSERT INTO permissions (name, module) VALUES
  ('checkins.read',   'checkins'),
  ('checkins.create', 'checkins'),
  ('checkins.update', 'checkins')
ON CONFLICT (name) DO NOTHING;

-- admin: every permission (covers the rows added above)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- reception and operations run the front desk: read + check in + check out
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN ('checkins.read', 'checkins.create', 'checkins.update')
  WHERE r.name IN ('reception', 'operations')
ON CONFLICT DO NOTHING;

-- housekeeping and accounts: read-only visibility of occupancy
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name = 'checkins.read'
  WHERE r.name IN ('housekeeping', 'accounts')
ON CONFLICT DO NOTHING;
