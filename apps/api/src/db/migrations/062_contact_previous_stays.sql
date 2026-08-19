-- Stay history carried over from Little Hotelier (the old booking system).
--
-- The LH export we migrated in 061 was a GUEST list, not a booking list: it gave us one row
-- per stay, so we can count how many times someone stayed, but it carried no dates and no
-- amounts, and the owner no longer has access to pull them. That count is real history and
-- the CRM should know it — a guest who stayed 100 times must not read as a cold prospect
-- just because their bookings predate this system.
--
-- It lives on the CONTACT, deliberately not as synthesised `reservations` rows: fake bookings
-- would have to invent dates and money, and would then flow into occupancy, ADR, RevPAR and
-- every revenue report — corrupting the numbers the business is judged on. A plain count on
-- the contact keeps the booking ledger honest.
--
-- 0 = "no carried-over history", which is correct for every guest booked in this system.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS previous_stays integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN contacts.previous_stays IS
  'Stays completed in the previous booking system (Little Hotelier), migrated 2026-08. Count only — no dates or amounts survived the export. 0 for guests originating in LSP.';

-- Segments and the guests list both sort on this, over the whole table rather than a page.
CREATE INDEX IF NOT EXISTS idx_contacts_previous_stays
  ON contacts (previous_stays DESC)
  WHERE deleted_at IS NULL AND previous_stays > 0;
