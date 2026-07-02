-- Phase 3 (A2): scoped service-provider login.
--
-- A contractor is an external repair person with a real login whose world is
-- only the work orders assigned to them (enforced in the maintenance routes,
-- not here). Their capability set is deliberately narrower than staff:
--
--   maintenance.work     NEW — start work on their own ticket (staff use
--                        maintenance.update for this, but update also guards
--                        edit/assign/cost/cancel, which contractors must not do)
--   maintenance.read     see their ticket queue (list is filtered to their own)
--   maintenance.complete finish their own ticket (with the after photo)
--   files.create/read    before/after photos
--
-- No create, no assign, no cost, no approve — accountability for money and
-- sign-off stays with staff.

INSERT INTO roles (name) VALUES ('contractor')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (name, module) VALUES
  ('maintenance.work', 'maintenance')
ON CONFLICT (name) DO NOTHING;

-- admin: every permission (keeps the "admin has everything" invariant).
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'maintenance.work'
  WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- The staff roles that already run repairs keep working exactly as before via
-- maintenance.update; maintenance.work is granted to them too so the start
-- action has ONE canonical permission going forward.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'maintenance.work'
  WHERE r.name IN ('operations', 'maintenance')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN (
    'maintenance.read',
    'maintenance.work',
    'maintenance.complete',
    'files.create',
    'files.read'
  )
  WHERE r.name = 'contractor'
ON CONFLICT DO NOTHING;
