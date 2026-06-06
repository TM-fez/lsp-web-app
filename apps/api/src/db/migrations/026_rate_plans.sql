-- Sprint 8 — Commercial Core: Pricing domain.
-- Rate plans hold the base nightly/weekly/monthly tariff per unit type.
-- All money is stored as INTEGER minor units (thebe; 100 thebe = 1 Pula),
-- currency BWP. Tax is expressed in basis points (1400 = 14% VAT).

CREATE TABLE rate_plans (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_type     room_type    NOT NULL,
  name          VARCHAR(120) NOT NULL,
  nightly_rate  INTEGER      NOT NULL,
  weekly_rate   INTEGER      NOT NULL,
  monthly_rate  INTEGER      NOT NULL,
  min_nights    INTEGER      NOT NULL DEFAULT 1,
  max_guests    INTEGER      NOT NULL DEFAULT 2,
  deposit_pct   INTEGER      NOT NULL DEFAULT 50,
  tax_rate_bps  INTEGER      NOT NULL DEFAULT 1400,
  currency      VARCHAR(3)   NOT NULL DEFAULT 'BWP',
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by    UUID         NOT NULL REFERENCES users(id),
  updated_by    UUID         NOT NULL REFERENCES users(id),
  deleted_at    TIMESTAMPTZ,
  deleted_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT rate_plans_rates_positive   CHECK (nightly_rate > 0 AND weekly_rate > 0 AND monthly_rate > 0),
  CONSTRAINT rate_plans_deposit_pct_rng  CHECK (deposit_pct BETWEEN 0 AND 100),
  CONSTRAINT rate_plans_tax_bps_rng      CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT rate_plans_min_nights_pos   CHECK (min_nights >= 1),
  CONSTRAINT rate_plans_max_guests_pos   CHECK (max_guests >= 1)
);

-- At most one active plan per unit type (the one the quote engine resolves).
CREATE UNIQUE INDEX rate_plans_active_unit_type_unique
  ON rate_plans(unit_type) WHERE active AND deleted_at IS NULL;

CREATE INDEX rate_plans_active_idx ON rate_plans(created_at DESC) WHERE deleted_at IS NULL;
