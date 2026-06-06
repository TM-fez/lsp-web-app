-- Sprint 8 — Commercial Core: Invoice foundation.
-- Lightweight, VAT-compatible invoice records (DEPOSIT / BALANCE / REFUND).
-- This is NOT an accounting system: no ledger, no double-entry. Every mutation
-- is audited. Receipt attachments reference the existing Files platform.

CREATE TYPE invoice_kind   AS ENUM ('DEPOSIT', 'BALANCE', 'REFUND');
CREATE TYPE invoice_status AS ENUM ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'VOID');

CREATE TABLE invoices (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  number          VARCHAR(40)    NOT NULL UNIQUE,
  hold_id         UUID           REFERENCES holds(id) ON DELETE SET NULL,
  quote_id        UUID           REFERENCES quotes(id) ON DELETE SET NULL,
  reservation_id  UUID           REFERENCES reservations(id) ON DELETE SET NULL,
  kind            invoice_kind   NOT NULL,
  currency        VARCHAR(3)     NOT NULL DEFAULT 'BWP',
  subtotal_amount INTEGER        NOT NULL,
  tax_rate_bps    INTEGER        NOT NULL,
  tax_amount      INTEGER        NOT NULL,
  total_amount    INTEGER        NOT NULL,
  status          invoice_status NOT NULL DEFAULT 'ISSUED',
  receipt_file_id UUID           REFERENCES files(id) ON DELETE SET NULL,
  issued_by       UUID           NOT NULL REFERENCES users(id),
  created_by      UUID           NOT NULL REFERENCES users(id),
  updated_by      UUID           NOT NULL REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID           REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT invoices_amounts_nonneg CHECK (subtotal_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0)
);

CREATE INDEX invoices_hold_idx    ON invoices(hold_id)   WHERE deleted_at IS NULL;
CREATE INDEX invoices_quote_idx   ON invoices(quote_id)  WHERE deleted_at IS NULL;
CREATE INDEX invoices_status_idx  ON invoices(status)    WHERE deleted_at IS NULL;
CREATE INDEX invoices_created_idx ON invoices(created_at DESC) WHERE deleted_at IS NULL;
