-- Phase 5 (A6): in-apartment QR guest self check-in — the OTA-to-direct capture.
--
-- guest_qr_token is a stable, unguessable per-unit token embedded in the QR sticker
-- that lives in the apartment. It is DELIBERATELY separate from ical_token (migration
-- 046): rotating the guest code must never break the Booking.com export feed, and the
-- guest code must never expose the channel calendar. Every unit gets one by default so
-- its sticker works immediately; staff can rotate it.
--
-- self_checkin_at stamps the moment a guest confirmed their own details from the unit,
-- turning an anonymous OTA stay into a real, re-bookable CRM contact.

ALTER TABLE rooms
  ADD COLUMN guest_qr_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX rooms_guest_qr_token_idx ON rooms(guest_qr_token);

ALTER TABLE reservations
  ADD COLUMN self_checkin_at TIMESTAMPTZ;
