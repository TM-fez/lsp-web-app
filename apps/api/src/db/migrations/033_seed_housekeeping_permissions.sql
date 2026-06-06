-- Sprint 9 — Operations Cockpit: RBAC permissions.
-- Adds housekeeping.* (the cleaning workflow) and cockpit.read (the unified
-- read-only board aggregator) and grants them to the operational roles.

INSERT INTO permissions (name, module) VALUES
  ('housekeeping.read',   'housekeeping'),
  ('housekeeping.update', 'housekeeping'),
  ('cockpit.read',        'cockpit')
ON CONFLICT (name) DO NOTHING;

-- admin: every permission (covers the rows added above)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('housekeeping.read', 'housekeeping.update', 'cockpit.read')
  WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- operations & reception: run the cockpit and the cleaning queue end-to-end.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('housekeeping.read', 'housekeeping.update', 'cockpit.read')
  WHERE r.name IN ('operations', 'reception')
ON CONFLICT DO NOTHING;

-- housekeeping role: do the turns, and see the board to know what to turn.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('housekeeping.read', 'housekeeping.update', 'cockpit.read')
  WHERE r.name = 'housekeeping'
ON CONFLICT DO NOTHING;
