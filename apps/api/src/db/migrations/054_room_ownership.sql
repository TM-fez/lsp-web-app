-- Phase 3 (A2): L&P-unit vs third-party-landlord financial mapping.
--
-- Some units are owned by Lifestyle outright; others belong to third-party
-- landlords who bear (or are billed back for) their repair costs. Until now the
-- money trail on a repair was who-did/who-approved only — this adds WHOSE UNIT
-- it was, so the expenses view can attribute every repair cost to the right
-- owner. Ownership is per-room (a building can be mixed).
--
-- landlord_name/phone are free text on the unit, mirroring the
-- contractor_name/phone convention on work orders (and reusing the wa.me
-- WhatsApp deep-link button in the UI).

CREATE TYPE room_ownership AS ENUM ('LIFESTYLE', 'LANDLORD');

ALTER TABLE rooms
  ADD COLUMN ownership      room_ownership NOT NULL DEFAULT 'LIFESTYLE',
  ADD COLUMN landlord_name  TEXT,
  ADD COLUMN landlord_phone VARCHAR(50);
