-- Phase 2 — Recurring operating costs: templates that generate one real
-- operating_expenses row per month (rent, insurance, software, …). Generation is
-- idempotent per month via a tag on operating_expenses.notes ('recurring:<id>:<YYYY-MM>').
-- Reuses the opex.* permissions — recurring is just managed operating costs.

CREATE TABLE recurring_operating_costs (
  id           UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID                       REFERENCES properties(id) ON DELETE SET NULL,
  category     operating_expense_category NOT NULL,
  description  VARCHAR(300)               NOT NULL,
  vendor       VARCHAR(200),
  amount       INTEGER                    NOT NULL,            -- thebe (100 = 1 BWP)
  day_of_month SMALLINT                   NOT NULL DEFAULT 1,
  active       BOOLEAN                    NOT NULL DEFAULT TRUE,
  notes        TEXT,
  created_by   UUID                       NOT NULL REFERENCES users(id),
  updated_by   UUID                       NOT NULL REFERENCES users(id),
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID                       REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  CONSTRAINT recurring_amount_pos  CHECK (amount > 0),
  CONSTRAINT recurring_day_valid   CHECK (day_of_month BETWEEN 1 AND 28)
);

CREATE INDEX recurring_costs_active_idx ON recurring_operating_costs(active) WHERE deleted_at IS NULL;
