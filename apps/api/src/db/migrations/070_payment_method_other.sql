-- postgres-migrations disable-transaction
--
-- Add an OTHER payment method ("method not recorded").
--
-- Why (stage-1 money fixes): marking an invoice paid from the Invoices screen collects
-- money but never asked how it arrived, so it left NO payment record at all — the
-- Payments page (which lists payment intents) and the Invoices page then disagreed about
-- what had been paid. Fixing that means the settle writes a payment row, and a payment
-- row needs a method. Guessing CASH would put an invented fact into cash reconciliation,
-- so there is an explicit "not recorded" value instead. Callers that DO know the method
-- (desk payments, the cockpit wizard) keep sending the real one.
--
-- Run OUTSIDE a transaction, like 045/065: Postgres forbids USING a freshly-added enum
-- value in the transaction that added it. IF NOT EXISTS makes it re-runnable.

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'OTHER';
