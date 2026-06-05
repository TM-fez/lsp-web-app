-- Forward-only: seed the Rooms permissions that the rooms routes guard with
-- (rooms.{read,create,update,delete}) and grant them to roles.

INSERT INTO permissions (name, module) VALUES
  ('rooms.read',   'rooms'),
  ('rooms.create', 'rooms'),
  ('rooms.update', 'rooms'),
  ('rooms.delete', 'rooms')
ON CONFLICT (name) DO NOTHING;

-- admin: every permission (covers the rows added above)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- operations: full room management
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN ('rooms.read', 'rooms.create', 'rooms.update', 'rooms.delete')
  WHERE r.name = 'operations'
ON CONFLICT DO NOTHING;

-- maintenance: read rooms and toggle their status (maintenance / restore)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN ('rooms.read', 'rooms.update')
  WHERE r.name = 'maintenance'
ON CONFLICT DO NOTHING;

-- reception, housekeeping, accounts: read-only visibility of rooms
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name = 'rooms.read'
  WHERE r.name IN ('reception', 'housekeeping', 'accounts')
ON CONFLICT DO NOTHING;
