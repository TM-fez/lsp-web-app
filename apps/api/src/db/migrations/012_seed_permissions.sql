-- Insert permissions
INSERT INTO permissions (name, module) VALUES
  ('users:read',      'users'),
  ('users:create',    'users'),
  ('users:update',    'users'),
  ('users:delete',    'users'),
  ('dashboard:read',  'dashboard'),
  ('contacts:read',   'crm'),
  ('contacts:create', 'crm'),
  ('contacts:update', 'crm'),
  ('contacts:delete', 'crm'),
  ('files:upload',    'files'),
  ('files:delete',    'files'),
  ('flags:manage',    'flags')
ON CONFLICT (name) DO NOTHING;

-- admin: all permissions
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- reception
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN (
    'dashboard:read',
    'contacts:read', 'contacts:create', 'contacts:update',
    'files:upload'
  )
  WHERE r.name = 'reception'
ON CONFLICT DO NOTHING;

-- operations
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN (
    'dashboard:read',
    'contacts:read', 'contacts:create', 'contacts:update', 'contacts:delete',
    'files:upload'
  )
  WHERE r.name = 'operations'
ON CONFLICT DO NOTHING;

-- accounts
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN (
    'dashboard:read',
    'contacts:read'
  )
  WHERE r.name = 'accounts'
ON CONFLICT DO NOTHING;

-- housekeeping and maintenance: dashboard read only for Sprint 1
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name = 'dashboard:read'
  WHERE r.name IN ('housekeeping', 'maintenance')
ON CONFLICT DO NOTHING;
