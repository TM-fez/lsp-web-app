-- Sprint 8 — Commercial Core: RBAC permissions.
-- Adds pricing.* / quotes.* / holds.* / payments.* / invoices.* and grants them
-- to existing roles. (There is no dedicated 'manager' role in this schema; the
-- revenue-authority grants — pricing.override, invoices.refund — go to admin and
-- accounts.)

INSERT INTO permissions (name, module) VALUES
  ('pricing.read',     'pricing'),
  ('pricing.create',   'pricing'),
  ('pricing.update',   'pricing'),
  ('pricing.override', 'pricing'),
  ('quotes.read',      'quotes'),
  ('quotes.create',    'quotes'),
  ('holds.read',       'holds'),
  ('holds.create',     'holds'),
  ('holds.update',     'holds'),
  ('payments.read',    'payments'),
  ('payments.create',  'payments'),
  ('payments.update',  'payments'),
  ('invoices.read',    'invoices'),
  ('invoices.create',  'invoices'),
  ('invoices.update',  'invoices'),
  ('invoices.refund',  'invoices')
ON CONFLICT (name) DO NOTHING;

-- admin: every permission (covers the rows added above)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- accounts: revenue authority — full pricing/payments/invoices, read quotes/holds
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN (
    'pricing.read', 'pricing.create', 'pricing.update', 'pricing.override',
    'quotes.read', 'holds.read',
    'payments.read', 'payments.create', 'payments.update',
    'invoices.read', 'invoices.create', 'invoices.update', 'invoices.refund'
  )
  WHERE r.name = 'accounts'
ON CONFLICT DO NOTHING;

-- reception: front desk — quote, hold, take payments, read invoices
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN (
    'pricing.read',
    'quotes.read', 'quotes.create',
    'holds.read', 'holds.create', 'holds.update',
    'payments.read', 'payments.create',
    'invoices.read'
  )
  WHERE r.name = 'reception'
ON CONFLICT DO NOTHING;

-- operations: quote/hold management + read pricing/payments/invoices
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN (
    'pricing.read',
    'quotes.read', 'quotes.create',
    'holds.read', 'holds.create', 'holds.update',
    'payments.read',
    'invoices.read'
  )
  WHERE r.name = 'operations'
ON CONFLICT DO NOTHING;
