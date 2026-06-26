-- System actors for channel sync (DATA SEED — no schema change).
--
-- Imported Booking.com bookings are stored as BLOCKED reservations (decision A1), but
-- reservations.contact_id and reservations.created_by are both NOT NULL. An OTA guest is
-- not an LSP CRM contact, and the importer runs from cron with no logged-in user. So we
-- seed two synthetic actors with FIXED ids that the importer references as constants
-- (channel.types.ts: SYSTEM_USER_ID / SYSTEM_OTA_CONTACT_ID):
--
--   1. A non-login service user "Channel Sync" — active=false and an unusable password
--      hash ('!', which bcrypt can never match), so it can never authenticate. It exists
--      only to satisfy created_by / updated_by and to attribute the activity-feed entry.
--   2. A synthetic company contact "Booking.com (imported)" that every imported block
--      hangs off of.
--
-- Both inserts are idempotent (ON CONFLICT (id) DO NOTHING).

INSERT INTO users (id, role_id, name, email, password_hash, active)
SELECT '00000000-0000-4000-a000-000000000001', r.id, 'Channel Sync', 'channel-sync@system.lsp', '!', false
FROM roles r
WHERE r.name = 'admin'
ON CONFLICT (id) DO NOTHING;

INSERT INTO contacts (id, type, name, created_by, updated_by)
VALUES (
  '00000000-0000-4000-a000-000000000002',
  'company',
  'Booking.com (imported)',
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000001'
)
ON CONFLICT (id) DO NOTHING;
