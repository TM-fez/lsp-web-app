-- Insert Maintenance permissions
INSERT INTO permissions (name, module) VALUES
  ('maintenance.read', 'maintenance'),
  ('maintenance.create', 'maintenance'),
  ('maintenance.update', 'maintenance'),
  ('maintenance.complete', 'maintenance');

-- Grant to admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'admin' AND p.module = 'maintenance';

-- Grant to operations
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'operations' AND p.module = 'maintenance';

-- Grant to maintenance
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'maintenance' AND p.module = 'maintenance';
