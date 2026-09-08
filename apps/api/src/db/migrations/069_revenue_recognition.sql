--
-- G30 — the nightly revenue recognition ledger. Revenue moves from cash-basis to
-- accrual, recognised per night.
--
-- Why (owner decision 2026-09-07): LSP is the book of record for revenue. The
-- owner's driver was a P&L that reads correctly month by month — revenue EARNED in
-- September must show in September even when the guest pays in October, and
-- October's payment must then show September's debt as settled.
--
-- What was actually wrong: `/reports/pnl` is a HYBRID. Revenue was cash-basis
-- (summed from PAID invoices, bucketed by invoice date) while costs were already
-- accrual (`operating_expenses.incurred_on`, `maintenance_work_orders.opened_at`).
-- The two sides of the same month were being measured on different clocks, which is
-- the real reason the monthly margin did not read correctly. A pay-later guest
-- (invariant 3 — CONFIRMED no longer means paid) makes that gap wider, not narrower.
--
-- The grain is one row per booking per NIGHT, because a night is the thing actually
-- sold and the only unit that never straddles a month boundary. A stay of
-- 28 Sep – 3 Oct is five rows, and September's P&L takes exactly the three that fall
-- in September. Half-open `[)` like every other range here (invariant 4): the
-- check-out date earns nothing, which is why same-day checkout/checkin is legal
-- without double-counting a night.
--
-- ── Versioned by SUPERSEDE, never updated in place ──────────────────────────────
--
-- A recognised night is a statement about a period that may already have been
-- reported. Editing it in place would silently restate a month the owner has read,
-- so a change writes a NEW row and marks the old one superseded. The live ledger is
-- the rows where `superseded_at IS NULL` — that predicate does the job `deleted_at
-- IS NULL` does everywhere else (invariant 5), and it is why this table deliberately
-- has NO deleted_at: a ledger you can delete from is not a ledger. Nothing may
-- DELETE from this table; the guard is a rule today and should become a trigger when
-- void-instead-of-delete lands for posted documents.
--
-- This is also the structure period close needs, which is why the shape is worth
-- paying for now even though close itself is deferred (tracked under G29). When
-- close arrives, superseding a night inside a CLOSED period stops being legal and
-- becomes a credit note in the open one instead — a new rule over this table, not a
-- rewrite of it.
--
-- ── The money ───────────────────────────────────────────────────────────────────
--
-- `amount` is GROSS (VAT-inclusive) thebe, matching invoices; net revenue is
-- `amount - tax_amount`. Storing both means the P&L and a BURS return can be
-- answered from the same row without either being derived by a caller who might
-- round differently.
--
-- The stay total is split across its nights by the writer, which distributes the
-- indivisible remainder to the EARLIEST nights so the rows sum to the total exactly
-- (invariant 1 — integer thebe, never floats). Earliest rather than latest is
-- arbitrary but FIXED: on a stay that straddles month end the choice decides which
-- month gets the spare thebe, so changing it later would restate closed months for
-- no gain.
--
-- `room_id` is denormalised rather than joined through the reservation on purpose.
-- A booking moved to another unit mid-stay changes `reservations.room_id`, and
-- resolving the room at READ time would retrospectively move already-earned nights
-- to the new unit — putting nights on a landlord's statement for a unit that was
-- empty. The room that earned the night is a fact about the night.
--
-- `total_source` carries the folio's existing vocabulary (FOLIO = the frozen agreed
-- total; PRICED = priced at TODAY's rates because nothing was ever frozen). Rate
-- plans have no effective dating, so a PRICED row is a RECONSTRUCTION, not a
-- recovery, and every screen that totals these rows must be able to say so.
--
-- Adding this migration means hand-updating src/db/types.ts (the Kysely Database
-- interface is hand-written, not generated) — done in the same commit.

CREATE TABLE revenue_recognition (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id    uuid        NOT NULL REFERENCES reservations(id),
  room_id           uuid        NOT NULL REFERENCES rooms(id),
  stay_date         date        NOT NULL,
  currency          varchar(3)  NOT NULL DEFAULT 'BWP',
  amount            integer     NOT NULL,
  tax_amount        integer     NOT NULL,
  tax_rate_bps      integer     NOT NULL,
  total_source      varchar(8)  NOT NULL,
  version           integer     NOT NULL DEFAULT 1,
  superseded_at     timestamptz,
  superseded_by     uuid        REFERENCES revenue_recognition(id),
  superseded_reason text,
  created_by        uuid        REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Money is integer minor units and revenue is never negative: a reversal is a
  -- superseding row, not a negative one. Tax is part of the gross, so it cannot
  -- exceed it.
  CONSTRAINT revenue_recognition_amounts_sane
    CHECK (amount >= 0 AND tax_amount >= 0 AND tax_amount <= amount),
  CONSTRAINT revenue_recognition_total_source
    CHECK (total_source IN ('FOLIO', 'PRICED')),
  -- Superseded is a pair: a row is either live (both null) or replaced, with the
  -- timestamp set. `superseded_by` stays nullable within that — a cancelled stay
  -- supersedes its nights with no replacement row to point at.
  CONSTRAINT revenue_recognition_superseded_pair
    CHECK ((superseded_at IS NOT NULL) OR (superseded_by IS NULL AND superseded_reason IS NULL))
);

-- The invariant that makes the ledger readable: at most ONE live row per booking per
-- night. Without it a re-price that failed halfway would double-count a night, and
-- the P&L would be wrong in the direction nobody checks.
CREATE UNIQUE INDEX revenue_recognition_live_night
  ON revenue_recognition (reservation_id, stay_date)
  WHERE superseded_at IS NULL;

-- Reporting reads the live ledger by date window, and owner statements read it by
-- unit. Both are partial on the live predicate: superseded history is audit, and no
-- report should ever pay to scan it.
CREATE INDEX revenue_recognition_live_by_date
  ON revenue_recognition (stay_date)
  WHERE superseded_at IS NULL;

CREATE INDEX revenue_recognition_live_by_room
  ON revenue_recognition (room_id, stay_date)
  WHERE superseded_at IS NULL;

-- The whole version history of one booking, for the audit question "what did this
-- stay earn, and what did we say it earned before?".
CREATE INDEX revenue_recognition_by_reservation
  ON revenue_recognition (reservation_id, stay_date, version);

COMMENT ON TABLE revenue_recognition IS
  'G30 accrual revenue ledger: one row per booking per night. Live rows are those '
  'with superseded_at IS NULL. Never UPDATE a recognised night and never DELETE '
  'one — supersede it with a new version.';

COMMENT ON COLUMN revenue_recognition.amount IS
  'Gross (VAT-inclusive) thebe earned for this night. Net revenue is amount - tax_amount.';

COMMENT ON COLUMN revenue_recognition.total_source IS
  'FOLIO = split from the frozen agreed total. PRICED = reconstructed at the rate '
  'plan active when the row was written, because no total was ever frozen. A PRICED '
  'row is a reconstruction and must be labelled as one wherever it is totalled.';
