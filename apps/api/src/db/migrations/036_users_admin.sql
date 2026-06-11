-- Users & Roles administration: staff-login management + team hierarchy.
--
-- 1. users.* permissions so only authorized roles (admin) can manage staff logins.
-- 2. users.is_lead — team rank (head cleaner / vice) without inventing new roles.
-- 3. user_permissions — per-user EXTRA grants on top of the role, for staff who
--    wear a second hat (e.g. a cleaner who also covers reception). Auth unions
--    these with the role's permissions at login.
-- 4. housekeeping.inspect — approving a clean is a lead/supervisor action; the
--    base housekeeping role can start cleans and mark ready, but inspection is
--    granted per-user (leads) or via supervisory roles.

ALTER TABLE users ADD COLUMN is_lead BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE user_permissions (
  user_id       UUID    NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, permission_id)
);

INSERT INTO permissions (name, module) VALUES
  ('users.read',           'users'),
  ('users.create',         'users'),
  ('users.update',         'users'),
  ('users.reset_password', 'users'),
  ('housekeeping.inspect', 'housekeeping')
ON CONFLICT (name) DO NOTHING;

-- admin: full staff management + inspection.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN
    ('users.read', 'users.create', 'users.update', 'users.reset_password', 'housekeeping.inspect')
  WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- operations & reception already supervise the cleaning queue end-to-end;
-- they keep the inspection (approval) step.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'housekeeping.inspect'
  WHERE r.name IN ('operations', 'reception')
ON CONFLICT DO NOTHING;

-- NOTE: the base housekeeping role deliberately does NOT get housekeeping.inspect —
-- cleaners do the turns; the head cleaner / vice (is_lead users) approve them via
-- a per-user grant in user_permissions.
