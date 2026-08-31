-- Two client corrections that were being enforced as production rules by defaults
-- nobody had ever revisited (see the 2026-08-31 walkthrough).
--
-- 1) GUEST LIMITS. A Standard and a Deluxe unit each sleep FOUR. Two separate
--    numbers were both saying two:
--      · rate_plans.max_guests — quotes.service rejects the booking outright
--        ("Maximum 2 guest(s) for STANDARD"), so a family of four was being turned
--        away at the quote stage;
--      · rooms.capacity — availability search filters on r.capacity >= guests, so
--        a search for four returned nothing at all.
--    Both have to move or the fix is invisible: one lets the unit be FOUND, the
--    other lets it be BOOKED.
--
-- 2) VAT. Lifestyle does not add tax on top of its rates — the advertised price is
--    the price the guest pays. The engine treats tax as EXCLUSIVE (taxExclusive()
--    adds it on top of the subtotal), so a 14% rate was inflating every quote by
--    14% over the advertised figure. Zero is the correct rate for that model.
--    Deliberately NOT retrospective: invoices and quotes carry their own frozen
--    tax_rate_bps/tax_amount, so documents already issued keep the figures they
--    were issued with. Only new pricing changes.

-- ── 1. Guest limits ──────────────────────────────────────────────────────────

-- New rate plans should start at the real unit size, not the old 2.
ALTER TABLE rate_plans ALTER COLUMN max_guests SET DEFAULT 4;

UPDATE rate_plans
   SET max_guests = 4,
       updated_at = NOW()
 WHERE unit_type IN ('STANDARD', 'DELUXE')
   AND max_guests < 4
   AND deleted_at IS NULL;

-- Availability search: the unit must also be big enough to be offered.
-- Guarded on < 4 so any unit deliberately set larger is left alone.
ALTER TABLE rooms ALTER COLUMN capacity SET DEFAULT 4;

UPDATE rooms
   SET capacity   = 4,
       updated_at = NOW()
 WHERE type IN ('STANDARD', 'DELUXE')
   AND capacity < 4
   AND deleted_at IS NULL;

-- ── 2. Zero-rated pricing ────────────────────────────────────────────────────

ALTER TABLE rate_plans ALTER COLUMN tax_rate_bps SET DEFAULT 0;

UPDATE rate_plans
   SET tax_rate_bps = 0,
       updated_at   = NOW()
 WHERE tax_rate_bps <> 0
   AND deleted_at IS NULL;
