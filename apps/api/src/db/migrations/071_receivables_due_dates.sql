--
-- Stage-1 money fixes: due dates (so "overdue" exists), reservation-keyed invoice
-- lookups, and payment rows that need no hold.
--
-- 1. invoices.due_date — until now an invoice had no due date at all, so "ageing" was
--    just days-since-created and Accounts could not ask the one question that matters:
--    what is OVERDUE. NULL means "no due date" (refund credit notes).
--
--    Rule (also applied by the API when it raises an invoice — see invoices.due.ts):
--        due_date = LATER OF (issue day, check-in day)  +  INVOICE_TERMS_DAYS (default 7)
--    The "later of" is deliberate: a guest is not late paying for a stay that has not
--    started, and pay-later clients settle after arrival. Plain issue-date + terms would
--    flag every booking made more than a week ahead as overdue the moment it was raised.
--    Days are Africa/Gaborone calendar days (invariant 2). The 7 in this backfill mirrors
--    the env default; change the env var for NEW invoices, re-run an UPDATE if the owner
--    wants existing ones moved.
--
-- 2. invoices(reservation_id) index — every folio read, payment lock and receivable
--    reconcile now filters on it; there was no index.
--
-- 3. payment_intents.hold_id / quote_id become nullable. A payment can now be recorded
--    straight against an INVOICE (marking it paid on the Invoices screen) with no hold or
--    quote behind it. The CHECK keeps the table honest: an intent hangs off a hold OR an
--    invoice, never nothing.
--
-- Adding this migration means hand-updating src/db/types.ts — done in the same commit.

ALTER TABLE invoices ADD COLUMN due_date date;

UPDATE invoices i
   SET due_date = (
         GREATEST(
           (i.created_at AT TIME ZONE 'Africa/Gaborone')::date,
           COALESCE(r.check_in_date, (i.created_at AT TIME ZONE 'Africa/Gaborone')::date)
         ) + 7
       )
  FROM (SELECT i2.id, res.check_in_date
          FROM invoices i2
          LEFT JOIN reservations res ON res.id = i2.reservation_id) r
 WHERE r.id = i.id
   AND i.kind <> 'REFUND';

CREATE INDEX invoices_reservation_idx ON invoices(reservation_id) WHERE deleted_at IS NULL;
CREATE INDEX invoices_open_due_idx    ON invoices(due_date)
  WHERE status IN ('ISSUED', 'PARTIALLY_PAID') AND deleted_at IS NULL;

ALTER TABLE payment_intents ALTER COLUMN hold_id  DROP NOT NULL;
ALTER TABLE payment_intents ALTER COLUMN quote_id DROP NOT NULL;
ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_has_anchor CHECK (hold_id IS NOT NULL OR invoice_id IS NOT NULL);
CREATE INDEX payment_intents_invoice_idx ON payment_intents(invoice_id) WHERE invoice_id IS NOT NULL;

COMMENT ON COLUMN invoices.due_date IS
  'Payment due day (Africa/Gaborone). Later of issue day and check-in day, plus INVOICE_TERMS_DAYS. NULL for refund credit notes.';
