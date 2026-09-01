-- Gate the shared activity feed behind a permission, so an EXTERNAL contractor cannot
-- read it.
--
-- GET /activity carried `authenticate` and nothing else, so any account with a valid
-- token could read the whole house's feed: who added which guest, who changed pricing,
-- who reset whose password, staff names, across every property. Contractors are outside
-- people with real logins (migration 053) whose world is meant to be "only the work
-- orders assigned to them". They never see the cockpit in the UI, but the endpoint was
-- one request away.
--
-- A new permission rather than reusing cockpit.read: that one is held by admin,
-- housekeeping, operations and reception, but NOT accounts or maintenance — gating on it
-- would silently take the feed away from two staff roles to fix a contractor problem.
-- activity.read is granted to every staff role and withheld from contractor only, which
-- is exactly the boundary being drawn.

INSERT INTO permissions (name, module) VALUES ('activity.read', 'activity')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'activity.read'
  WHERE r.name <> 'contractor'
ON CONFLICT DO NOTHING;
