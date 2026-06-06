-- Sprint 8 — Commercial Core: Payment intent domain.
-- A payment intent tracks an amount to be collected against a hold. There is NO
-- real gateway: outcomes are recorded explicitly so any future provider (card,
-- mobile money, EFT, cash, corporate credit) can drive the same state machine.
-- Retry-before-release: FAILURE bumps attempts -> RETRY until max_attempts.

CREATE TYPE payment_method AS ENUM ('CARD', 'MOBILE_MONEY', 'EFT', 'CASH', 'CORPORATE_CREDIT');
CREATE TYPE payment_status AS ENUM ('PENDING', 'RETRY', 'PAID', 'FAILED', 'EXPIRED');
CREATE TYPE payment_purpose AS ENUM ('DEPOSIT', 'BALANCE');
CREATE TYPE payment_attempt_outcome AS ENUM ('INITIATED', 'SUCCESS', 'FAILURE');

CREATE TABLE payment_intents (
  id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id      UUID            NOT NULL REFERENCES holds(id),
  quote_id     UUID            NOT NULL REFERENCES quotes(id),
  invoice_id   UUID,
  purpose      payment_purpose NOT NULL DEFAULT 'DEPOSIT',
  amount       INTEGER         NOT NULL,
  currency     VARCHAR(3)      NOT NULL DEFAULT 'BWP',
  method       payment_method  NOT NULL,
  status       payment_status  NOT NULL DEFAULT 'PENDING',
  attempts     INTEGER         NOT NULL DEFAULT 0,
  max_attempts INTEGER         NOT NULL DEFAULT 3,
  last_error   TEXT,
  paid_at      TIMESTAMPTZ,
  created_by   UUID            NOT NULL REFERENCES users(id),
  updated_by   UUID            NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_intents_amount_pos   CHECK (amount > 0),
  CONSTRAINT payment_intents_attempts_rng CHECK (attempts >= 0 AND max_attempts >= 1)
);

CREATE TABLE payment_attempts (
  id                UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id UUID                    NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  attempt_no        INTEGER                 NOT NULL,
  outcome           payment_attempt_outcome NOT NULL,
  method            payment_method          NOT NULL,
  reference         TEXT,
  note              TEXT,
  created_by        UUID                    NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

CREATE INDEX payment_intents_hold_idx   ON payment_intents(hold_id);
CREATE INDEX payment_intents_status_idx ON payment_intents(status);
CREATE INDEX payment_attempts_intent_idx ON payment_attempts(payment_intent_id);
