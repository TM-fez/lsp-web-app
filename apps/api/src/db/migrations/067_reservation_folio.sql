--
-- The booking folio: what the stay costs, frozen; and who said the stay is on.
--
-- Why (owner decision 2026-09-07, amending invariant 3): CONFIRMED used to mean two
-- things at once — "the stay is on" and "the money arrived" — because settlePaid()
-- was its only sanctioned writer. Some clients pay after the stay, so a guest could
-- not be confirmed or checked in until they had paid. Staff worked around it by not
-- booking at all, which is how a walk-in ends up with no record anywhere.
--
-- The fix splits those into two orthogonal axes:
--   · LIFECYCLE  — reservations.status. Unchanged set of values. This alone decides
--                  whether a booking holds the room.
--   · MONEY      — the folio: total (frozen here) / paid / outstanding (derived from
--                  invoices at read time). Decides nothing about availability.
--
-- ⚠️ The rule that keeps invariant 7 (and D01) true while the money model changes:
--    NO availability, overlap or channel-export query may reference folio_total_amount,
--    the derived payment state, or the invoices table. Whether a booking holds the room
--    is a question about its STATUS, never about its money. An unpaid booking holds the
--    room; so does a part-paid one. folio-invariant.test.ts asserts this.
--
-- Why the total is STORED rather than priced on demand: priceReservation() resolves the
-- room type's CURRENTLY ACTIVE rate plan (pricing.repository.findActiveByUnitType). Rate
-- plans have no effective dating, so changing a rate silently re-prices every past
-- booking. That is disqualifying now that LSP is the book of record for revenue (G30) —
-- and it is why markPaid's "amount exceeds the total" cap was unsound over time.
-- NULL means "not yet frozen": the folio read falls back to live pricing, so nothing
-- breaks for bookings that predate this migration or have never been quoted.
--
-- Runs INSIDE a transaction, unlike 045/065: this adds no enum value, which is the whole
-- point of DERIVING the payment state from invoices instead of storing a fourth status.
--
-- Adding this migration means hand-updating src/db/types.ts (the Kysely Database
-- interface is hand-written, not generated) — done in the same commit.

ALTER TABLE reservations
  ADD COLUMN folio_total_amount        integer,
  ADD COLUMN folio_currency            varchar(3)  NOT NULL DEFAULT 'BWP',
  ADD COLUMN confirmed_at              timestamptz,
  ADD COLUMN confirmed_by              uuid REFERENCES users(id),
  ADD COLUMN confirmed_without_payment boolean     NOT NULL DEFAULT false,
  ADD COLUMN confirmation_note         text;

-- Money is integer minor units (thebe) everywhere (invariant 1). A negative agreed
-- price is not a discount, it is a bug.
ALTER TABLE reservations
  ADD CONSTRAINT reservations_folio_total_nonneg
    CHECK (folio_total_amount IS NULL OR folio_total_amount >= 0);

-- Backfill: reconstruct the agreed total from the invoices already raised.
--
-- This works because markPaid raises a PAID receipt for the amount taken AND (since
-- #96) an ISSUED invoice for the remainder, so the non-refund invoices for a booking
-- sum to the stay total. REFUND rows are excluded: a refund reduces what was RECEIVED,
-- never what was AGREED.
--
-- Honest limit: this is a reconstruction, not a recovery. A booking that was never
-- invoiced stays NULL by construction (SUM over no rows is NULL) and falls back to live
-- pricing — which prices it at TODAY's rates, and will be wrong wherever rates have
-- moved since. Recorded against G30; the ledger fixes the future, it cannot fix the past.
UPDATE reservations r
   SET folio_total_amount = sub.total
  FROM (
        SELECT reservation_id, SUM(total_amount) AS total
          FROM invoices
         WHERE reservation_id IS NOT NULL
           AND kind <> 'REFUND'
           AND deleted_at IS NULL
         GROUP BY reservation_id
       ) sub
 WHERE r.id = sub.reservation_id
   AND r.deleted_at IS NULL
   AND sub.total > 0;

-- Existing CONFIRMED bookings reached that state through settlePaid(), so record what
-- is already true rather than leaving the new columns misleadingly blank: they were
-- confirmed WITH payment. confirmed_at/by stay NULL — the audit_logs row is the record
-- of who did it, and inventing a timestamp here would be fabricating history.
COMMENT ON COLUMN reservations.confirmed_without_payment IS
  'True when staff confirmed the stay without money in hand (confirmWithoutPayment). '
  'False for the payment path (settlePaid) and for claimed OTA bookings.';
