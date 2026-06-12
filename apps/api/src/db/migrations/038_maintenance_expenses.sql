-- Build 2a: contractor costs on repairs + the spend-approval / reconciliation flow.
--
-- A repair can carry the OUTSIDE contractor doing the work and what they cost.
-- Lifestyle's rule: no spend without approval — so a cost is "pending" until a
-- manager (admin/operations) approves it; then Accounts reconciles it against the
-- bank. Accounts sees the money via expenses.* perms WITHOUT maintenance access,
-- keeping the team separation intact.

ALTER TABLE maintenance_work_orders
  ADD COLUMN contractor_name    TEXT,
  ADD COLUMN cost_amount        INTEGER,            -- thebe (100 = 1 BWP)
  ADD COLUMN cost_approved_by   UUID REFERENCES users(id),
  ADD COLUMN cost_approved_at   TIMESTAMPTZ,
  ADD COLUMN cost_reconciled_by UUID REFERENCES users(id),
  ADD COLUMN cost_reconciled_at TIMESTAMPTZ;

INSERT INTO permissions (name, module) VALUES
  ('expenses.read',      'expenses'),
  ('expenses.approve',   'expenses'),
  ('expenses.reconcile', 'expenses')
ON CONFLICT (name) DO NOTHING;

-- admin: see, approve the spend, and reconcile.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('expenses.read', 'expenses.approve', 'expenses.reconcile')
  WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- operations (management): see + approve the spend.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('expenses.read', 'expenses.approve')
  WHERE r.name = 'operations'
ON CONFLICT DO NOTHING;

-- accounts: see + reconcile (NOT approve — and no maintenance access at all).
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('expenses.read', 'expenses.reconcile')
  WHERE r.name = 'accounts'
ON CONFLICT DO NOTHING;
