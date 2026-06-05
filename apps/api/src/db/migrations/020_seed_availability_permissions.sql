INSERT INTO permissions (name, module) VALUES 
('availability.read', 'availability')
ON CONFLICT (name) DO NOTHING;

-- Grant to admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'admin' AND p.name IN ('availability.read')
ON CONFLICT DO NOTHING;

-- Grant to agent role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'agent' AND p.name IN ('availability.read')
ON CONFLICT DO NOTHING;
