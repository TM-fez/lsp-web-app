-- Forward-only RBAC alignment.
--
-- Sprint 1 seeded colon-style permission names (e.g. 'contacts:read'), but the
-- CRM and Reservations routes guard with dotted, module-prefixed names:
--   crm.contacts.{read,create,update,delete}
--   crm.leads.{read,create,update,delete}
--   reservations.{read,create,update,delete}
-- As a result authorize(...) never matched and every CRM/Reservations endpoint
-- returned 403. This migration adds the permission rows the routes actually
-- require and grants them to the appropriate roles. (The legacy 'contacts:*'
-- rows from migration 012 are left intact but are no longer referenced.)

INSERT INTO permissions (name, module) VALUES
  ('crm.contacts.read',   'crm'),
  ('crm.contacts.create', 'crm'),
  ('crm.contacts.update', 'crm'),
  ('crm.contacts.delete', 'crm'),
  ('crm.leads.read',      'crm'),
  ('crm.leads.create',    'crm'),
  ('crm.leads.update',    'crm'),
  ('crm.leads.delete',    'crm'),
  ('reservations.read',   'reservations'),
  ('reservations.create', 'reservations'),
  ('reservations.update', 'reservations'),
  ('reservations.delete', 'reservations')
ON CONFLICT (name) DO NOTHING;

-- admin: every permission (covers the rows added above)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- reception: contacts (r/c/u), leads (r/c/u), reservations (full)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN (
    'crm.contacts.read', 'crm.contacts.create', 'crm.contacts.update',
    'crm.leads.read', 'crm.leads.create', 'crm.leads.update',
    'reservations.read', 'reservations.create', 'reservations.update', 'reservations.delete'
  )
  WHERE r.name = 'reception'
ON CONFLICT DO NOTHING;

-- operations: contacts (full), leads (full), reservations (full)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN (
    'crm.contacts.read', 'crm.contacts.create', 'crm.contacts.update', 'crm.contacts.delete',
    'crm.leads.read', 'crm.leads.create', 'crm.leads.update', 'crm.leads.delete',
    'reservations.read', 'reservations.create', 'reservations.update', 'reservations.delete'
  )
  WHERE r.name = 'operations'
ON CONFLICT DO NOTHING;

-- accounts: read-only across CRM + reservations
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN (
    'crm.contacts.read', 'crm.leads.read', 'reservations.read'
  )
  WHERE r.name = 'accounts'
ON CONFLICT DO NOTHING;
