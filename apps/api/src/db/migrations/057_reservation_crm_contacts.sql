-- Phase 4 (A4): CRM fields on the booking.
--
-- A corporate stay often has THREE people attached: the guest who sleeps there
-- (contact_id), the booking coordinator who arranged it (a PA / travel desk /
-- office manager — the person you call about the booking, and the person group
-- campaigns should target), and the billing/accounts contact the invoice goes
-- to. Both new fields are real contacts (not free text) so coordinators build
-- up booking history for the A4 segmentation work; both are optional — an
-- individual walk-in has neither.

ALTER TABLE reservations
  ADD COLUMN booking_coordinator_id UUID REFERENCES contacts(id),
  ADD COLUMN billing_contact_id     UUID REFERENCES contacts(id);

-- Segmentation + "bookings arranged by X" lookups.
CREATE INDEX reservations_coordinator_idx
  ON reservations(booking_coordinator_id)
  WHERE booking_coordinator_id IS NOT NULL AND deleted_at IS NULL;
