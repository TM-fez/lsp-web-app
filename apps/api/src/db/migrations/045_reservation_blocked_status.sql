-- postgres-migrations disable-transaction
--
-- Add the BLOCKED reservation status — an OTA-sourced calendar block imported from
-- Booking.com. It is its own migration, run OUTSIDE a transaction, on purpose:
--
--   Postgres forbids USING a freshly-added enum value in the same transaction that
--   added it. The next migration (046) references 'BLOCKED' in the no-overlap
--   constraint, so the value must already be committed. `disable-transaction` makes
--   this ALTER auto-commit immediately, and also keeps it portable to PG < 12 (which
--   cannot ADD VALUE inside a transaction at all). IF NOT EXISTS makes it re-runnable.
--
-- BLOCKED is set ONLY by channel sync (the importer), never by a user — see
-- UserInputReservationStatusEnum and the UpdateReservationSchema guard.

ALTER TYPE reservation_status ADD VALUE IF NOT EXISTS 'BLOCKED';
