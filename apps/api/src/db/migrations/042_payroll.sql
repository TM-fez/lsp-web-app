-- Phase 1 — HR / Payroll: per-employee compensation.
-- Employees are the existing staff (users). Compensation lives in its own table,
-- 1:1 with a user, so salaries stay behind payroll.* perms and never leak into the
-- general staff directory. Money is thebe (100 = 1 BWP). Every mutation is audited.

CREATE TYPE pay_frequency AS ENUM ('MONTHLY', 'WEEKLY');

CREATE TABLE staff_compensation (
  user_id        UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  job_title      VARCHAR(120),
  gross_amount   INTEGER       NOT NULL,                    -- thebe, per `frequency`
  frequency      pay_frequency NOT NULL DEFAULT 'MONTHLY',
  payment_method VARCHAR(40),                               -- Bank transfer / Cash / Mobile money
  bank_name      VARCHAR(120),
  bank_account   VARCHAR(60),
  start_date     DATE,
  active         BOOLEAN       NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_by     UUID          NOT NULL REFERENCES users(id),
  updated_by     UUID          NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_comp_amount_nonneg CHECK (gross_amount >= 0)
);

CREATE INDEX staff_compensation_active_idx ON staff_compensation(active);

-- ── Permissions ───────────────────────────────────────────────────────────────
-- payroll.read — see who gets paid what.  payroll.manage — set comp + post to costs.
INSERT INTO permissions (name, module) VALUES
  ('payroll.read',   'finance'),
  ('payroll.manage', 'finance')
ON CONFLICT (name) DO NOTHING;

-- admin + accounts: full payroll control.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('payroll.read', 'payroll.manage')
  WHERE r.name IN ('admin', 'accounts')
ON CONFLICT DO NOTHING;

-- operations (management): see payroll, no edits.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'payroll.read'
  WHERE r.name = 'operations'
ON CONFLICT DO NOTHING;
