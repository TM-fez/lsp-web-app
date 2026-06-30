-- WhatsApp follow-up (Phase 0): give the reusable wa.me button a number to dial
-- in the two places it was deferred for lack of a phone field —
--   • leads: the enquirer's phone (so an enquiry can be followed up directly), and
--   • maintenance work orders: the contractor's phone.
-- Both nullable; existing rows simply have no number and the button stays hidden.

ALTER TABLE leads ADD COLUMN phone TEXT;
ALTER TABLE maintenance_work_orders ADD COLUMN contractor_phone TEXT;
