-- Phase 5 (P5.2): post-stay follow-up email.
--
-- Stamps when the automated thank-you / review / book-direct email went out for a
-- completed stay, so the daily sweep sends it exactly once. NULL = not yet sent;
-- the sweep only considers stays that checked out in the last few days, so a stay
-- naturally drops out of the window rather than retrying forever.

ALTER TABLE reservations
  ADD COLUMN post_stay_email_at TIMESTAMPTZ;
