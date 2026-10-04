-- (Stage 2 re-test, owner decision 2026-10-04) Partial refunds.
--
-- A refund used to flip the WHOLE original invoice to REFUNDED, whatever the amount: P100
-- back on a P1,666 receipt read as "Refunded", and nothing remembered how much had gone
-- back, so the guard against refunding more than was paid only looked at one click.
-- Owner chose: the original stays PAID with "P100 refunded" shown, and can be refunded
-- again up to what is left; it becomes REFUNDED only when the whole amount has gone back.
--
-- For that each credit note must point at the invoice it reverses. Credit notes written
-- before this migration have no link; their originals were already marked REFUNDED, which
-- the code treats as "nothing left to refund" — the safe reading for history.

ALTER TABLE invoices
  ADD COLUMN refund_of_invoice_id uuid REFERENCES invoices(id);

CREATE INDEX invoices_refund_of_idx ON invoices (refund_of_invoice_id)
  WHERE refund_of_invoice_id IS NOT NULL;

-- A credit note reverses something; nothing else may carry the link.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_refund_of_only_on_refunds
  CHECK (refund_of_invoice_id IS NULL OR kind = 'REFUND');
