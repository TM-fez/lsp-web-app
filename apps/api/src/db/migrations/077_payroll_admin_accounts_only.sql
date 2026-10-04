-- (Owner decision 2026-10-04) Payroll is for admin and accounts only.
--
-- Migration 042 also gave operations `payroll.read`, so an operations manager could open
-- the Payroll page and see every employee and what they are paid. The re-test flagged it
-- and the owner agreed: salaries are an admin / accounts matter. Operations keeps every
-- other permission it had. A user who needs payroll as a second hat can still be granted
-- it individually under Users & Roles (extra permissions).

DELETE FROM role_permissions rp
 USING roles r, permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND r.name = 'operations'
   AND p.name IN ('payroll.read', 'payroll.manage');
