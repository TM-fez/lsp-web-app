-- Seed Files permissions
INSERT INTO permissions (name, module) VALUES 
('files.read', 'files'),
('files.create', 'files'),
('files.delete', 'files')
ON CONFLICT (name) DO NOTHING;

-- Grant to admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'admin' AND p.name IN ('files.read', 'files.create', 'files.delete')
ON CONFLICT DO NOTHING;

-- Grant to operations
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'operations' AND p.name IN ('files.read', 'files.create', 'files.delete')
ON CONFLICT DO NOTHING;

-- Grant to reception
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'reception' AND p.name IN ('files.read', 'files.create') -- Perhaps reception cannot delete, or maybe they can.
ON CONFLICT DO NOTHING;
