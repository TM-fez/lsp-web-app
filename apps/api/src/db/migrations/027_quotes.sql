-- Sprint 8 — Commercial Core: Quote engine.
-- A quote is an immutable, time-boxed price calculation. It does NOT reserve a
-- unit. Figures (base/adjustment/tax/deposit/total) are frozen at creation;
-- only `status` transitions (ACTIVE -> EXPIRED|CONSUMED) afterwards.

CREATE TYPE quote_status AS ENUM ('ACTIVE', 'EXPIRED', 'CONSUMED');

CREATE TABLE quotes (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_plan_id      UUID         NOT NULL REFERENCES rate_plans(id),
  unit_type         room_type    NOT NULL,
  check_in_date     DATE         NOT NULL,
  check_out_date    DATE         NOT NULL,
  guests            INTEGER      NOT NULL DEFAULT 1,
  nights            INTEGER      NOT NULL,
  currency          VARCHAR(3)   NOT NULL DEFAULT 'BWP',
  base_amount       INTEGER      NOT NULL,
  adjustment_amount INTEGER      NOT NULL DEFAULT 0,
  adjustment_reason TEXT,
  tax_rate_bps      INTEGER      NOT NULL,
  tax_amount        INTEGER      NOT NULL,
  deposit_amount    INTEGER      NOT NULL,
  total_amount      INTEGER      NOT NULL,
  breakdown         JSONB        NOT NULL DEFAULT '{}',
  status            quote_status NOT NULL DEFAULT 'ACTIVE',
  created_by        UUID         NOT NULL REFERENCES users(id),
  override_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
  expires_at        TIMESTAMPTZ  NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT quotes_date_order   CHECK (check_out_date > check_in_date),
  CONSTRAINT quotes_nights_pos   CHECK (nights > 0),
  CONSTRAINT quotes_guests_pos   CHECK (guests > 0),
  CONSTRAINT quotes_amounts_nonneg CHECK (
    base_amount >= 0 AND tax_amount >= 0 AND deposit_amount >= 0 AND total_amount >= 0
  )
);

CREATE INDEX quotes_status_idx     ON quotes(status);
CREATE INDEX quotes_rate_plan_idx  ON quotes(rate_plan_id);
CREATE INDEX quotes_expires_idx    ON quotes(expires_at) WHERE status = 'ACTIVE';
CREATE INDEX quotes_created_idx    ON quotes(created_at DESC);
