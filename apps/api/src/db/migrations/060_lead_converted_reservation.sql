-- Phase 5 (CRM): lead → booking conversion.
--
-- Links an enquiry to the reservation it became, so the CONVERTED status is backed
-- by a real booking and "which enquiries turn into stays" is answerable later. The
-- reservation itself follows the usual invariant (created PENDING; only payment
-- confirms it).

ALTER TABLE leads
  ADD COLUMN converted_reservation_id UUID REFERENCES reservations(id);

CREATE INDEX leads_converted_reservation_idx
  ON leads(converted_reservation_id)
  WHERE converted_reservation_id IS NOT NULL AND deleted_at IS NULL;
