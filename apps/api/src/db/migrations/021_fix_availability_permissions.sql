-- Grant availability.read to correct operational roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('reception', 'operations') AND p.name = 'availability.read'
ON CONFLICT DO NOTHING;
