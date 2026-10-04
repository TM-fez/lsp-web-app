-- (Re-test round 3, 2026-10-04) The Files library is a staff screen.
--
-- Contractors hold files.read / files.create so they can upload and view the photos on
-- their own repair jobs (migration 053). The same permission opened the whole Files
-- library screen to them — with only their own files in it (P6), but still an office
-- screen with an "Upload document" button that has nothing to do with their job.
-- The library gets its own permission, held by the office roles that use it.

INSERT INTO permissions (name, module) VALUES
  ('files.library', 'files')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name = 'files.library'
 WHERE r.name IN ('admin', 'accounts', 'operations', 'reception')
ON CONFLICT DO NOTHING;
