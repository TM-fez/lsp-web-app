-- (Re-test 2026-10-04) Who may see a unit's calendar-feed and guest-QR tokens.
--
-- (H6) hid both tokens from anyone without rooms.update. But maintenance and operations
-- hold rooms.update — they flag units for maintenance / out of service — so they still
-- received the iCal token (which publishes the unit's calendar to whoever holds it) and
-- the QR token (which checks a guest in). Setting up Booking.com sync and printing the
-- in-apartment QR is owner/admin work, so it gets its own permission, admin only.

INSERT INTO permissions (name, module) VALUES
  ('rooms.channel.manage', 'rooms')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name = 'rooms.channel.manage'
 WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;
