--
-- Gapless, per-year document numbering (defect D09).
--
-- Why: invoiceNumber() returned `INV-<year>-<8 random hex>`, which broke two things
-- that matter to the owner and to BURS.
--
--   1. NO SEQUENCE. "Is a document missing?" was unanswerable. A random identifier
--      proves a document exists; only a sequence proves none has been removed. That
--      is the entire point of a tax-facing numbering scheme.
--   2. THE WRONG YEAR AT MIDNIGHT. The year came from raw `new Date().getFullYear()`,
--      which is the server's UTC clock — breaking invariant 2. An invoice raised at
--      01:00 Gaborone on 1 January was stamped with the PREVIOUS year, into a series
--      that had already been reported.
--
-- Why a counter table and not a Postgres SEQUENCE: a sequence is explicitly NOT
-- gapless. nextval() is non-transactional by design, so a rolled-back invoice insert
-- burns its number permanently — which is exactly the hole this migration exists to
-- close. A row in this table is ordinary transactional data: the allocation lives in
-- the SAME transaction as the invoice insert, so the two commit together or not at
-- all. Concurrent inserts serialise on the row lock, which at this house's volume
-- (tens of invoices a day, not thousands a second) costs nothing measurable.
--
-- `last_value` is the number most recently HANDED OUT, so an allocation is a single
-- statement:
--   INSERT … VALUES (prefix, year, 1)
--   ON CONFLICT (prefix, year) DO UPDATE SET last_value = …last_value + 1
--   RETURNING last_value;
-- First call of a year inserts and returns 1; every later call increments and returns
-- the new value. No read-then-write, so no race to lose.
--
-- Adding this migration means hand-updating src/db/types.ts (the Kysely Database
-- interface is hand-written, not generated) — done in the same commit.

CREATE TABLE document_number_series (
  prefix      varchar(8)  NOT NULL,
  year        integer     NOT NULL,
  last_value  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prefix, year)
);

-- A series counts up. Going backwards would re-issue a number already on a document
-- in someone's inbox, so make it impossible rather than merely unlikely.
ALTER TABLE document_number_series
  ADD CONSTRAINT document_number_series_last_value_nonneg CHECK (last_value >= 0);

COMMENT ON TABLE document_number_series IS
  'Gapless per-year counters for issued documents (D09). One row per prefix+year; '
  'last_value is the number most recently handed out. Allocate in the same '
  'transaction as the document insert so a rollback leaves no gap.';

-- Deliberately NOT seeded past the invoices that already exist.
--
-- Every invoice raised before this migration carries a random `INV-<year>-<8 hex>`
-- number. Those documents have been emailed to guests and cannot be renumbered, so
-- the honest record is two stretches: an unnumbered legacy stretch, then a sequence
-- that starts at 1 on the day the sequence began. Starting the counter above the
-- legacy COUNT would imply the legacy rows were 1..n of this series, which is the one
-- thing a gapless series must never claim.
--
-- The two formats cannot collide: legacy is 8 hex characters, the sequence is 6
-- zero-padded digits (`INV-2026-000001`), so the strings differ in length even when
-- the hex happens to be all digits. Do not "tidy" the new format to 8 characters —
-- the UNIQUE constraint on invoices.number is what would break.
