-- Build 2b: Operating expenses — the recurring overhead (rent, payroll, utilities,
-- marketing…) that, alongside maintenance/contractor spend, turns revenue into real
-- profit. Unlike maintenance costs (which ride on a work order), these are a
-- standalone ledger Accounts owns. Property attribution is optional: company-wide
-- costs leave property_id NULL. Every mutation is audited. Money in thebe (100 = 1 BWP).

CREATE TYPE operating_expense_category AS ENUM (
  'RENT', 'PAYROLL', 'UTILITIES', 'MARKETING', 'INSURANCE', 'SUPPLIES', 'SOFTWARE', 'OTHER'
);

CREATE TABLE operating_expenses (
  id           UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID                       REFERENCES properties(id) ON DELETE SET NULL,
  category     operating_expense_category NOT NULL,
  description  VARCHAR(300)               NOT NULL,
  vendor       VARCHAR(200),
  amount       INTEGER                    NOT NULL,            -- thebe (100 = 1 BWP)
  currency     VARCHAR(3)                 NOT NULL DEFAULT 'BWP',
  incurred_on  DATE                       NOT NULL,
  notes        TEXT,
  created_by   UUID                       NOT NULL REFERENCES users(id),
  updated_by   UUID                       NOT NULL REFERENCES users(id),
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID                       REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  CONSTRAINT operating_expenses_amount_pos CHECK (amount > 0)
);

-- P&L groups by month over incurred_on; the dashboard also filters by property/category.
CREATE INDEX operating_expenses_incurred_idx ON operating_expenses(incurred_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX operating_expenses_property_idx ON operating_expenses(property_id)        WHERE deleted_at IS NULL;
CREATE INDEX operating_expenses_category_idx ON operating_expenses(category)           WHERE deleted_at IS NULL;

-- ── Permissions ───────────────────────────────────────────────────────────────
-- opex.* — the operating-expenses ledger.  reports.read — the Accounts dashboard.
INSERT INTO permissions (name, module) VALUES
  ('opex.read',    'finance'),
  ('opex.create',  'finance'),
  ('opex.update',  'finance'),
  ('opex.delete',  'finance'),
  ('reports.read', 'finance')
ON CONFLICT (name) DO NOTHING;

-- admin + accounts: full ledger control + reports.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('opex.read','opex.create','opex.update','opex.delete','reports.read')
  WHERE r.name IN ('admin', 'accounts')
ON CONFLICT DO NOTHING;

-- operations (management): read the ledger + see the reports, no write.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('opex.read', 'reports.read')
  WHERE r.name = 'operations'
ON CONFLICT DO NOTHING;
