-- (Audit 2026-10-11, M-3) Put the shared Booking.com placeholder contact back as it was.
--
-- Every unclaimed Booking.com block points at ONE placeholder contact (migration 047). Until
-- this release, the in-apartment QR self check-in treated it like any anonymous guest and
-- filled its blank name/email/phone with whatever the first guest typed — so every unclaimed
-- OTA booking in the estate then showed that person. The code no longer writes to it (the
-- guest gets their own record). This resets the placeholder in case it was already filled.
--
-- Nothing is lost: if it holds details, they are copied into an audit row first, so staff
-- can find the guest who typed them (the booking's own self-check-in audit row names it).
-- Idempotent: a clean placeholder writes no audit row and no change.

INSERT INTO audit_logs (user_id, action, entity, entity_id, diff)
SELECT '00000000-0000-4000-a000-000000000001',
       'UPDATE',
       'contacts',
       c.id,
       jsonb_build_object(
         'reason', 'Reset the shared Booking.com placeholder (audit M-3); these details were typed by a guest at QR check-in',
         'name', c.name,
         'email', c.email,
         'phone', c.phone
       )
  FROM contacts c
 WHERE c.id = '00000000-0000-4000-a000-000000000002'
   AND (c.name <> 'Booking.com (imported)' OR c.email IS NOT NULL OR c.phone IS NOT NULL);

UPDATE contacts
   SET name = 'Booking.com (imported)',
       email = NULL,
       phone = NULL,
       updated_at = now()
 WHERE id = '00000000-0000-4000-a000-000000000002'
   AND (name <> 'Booking.com (imported)' OR email IS NOT NULL OR phone IS NOT NULL);
