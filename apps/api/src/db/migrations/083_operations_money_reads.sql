-- (R4 owner decision 3a, 2026-10-04) Operations keeps reports and trends, but not the
-- money ledgers.
--
-- Operations held invoices.read, payments.read and opex.read from the original seeds,
-- so an operations manager could open every invoice, every payment and every company
-- cost. The owner's call: operations runs the house — bookings, rooms, repairs, and the
-- P&L / trends that tell them how the house is doing — while the documents behind the
-- money stay with admin, accounts and (for the desk) reception.
--
-- Kept on purpose: reports.read (P&L, Trends, Owner statements, Marketing) and
-- expenses.read / expenses.approve — approving a contractor's spend on a repair is an
-- operations job (migration 038: "no spend without approval").
--
-- The Finance cockpit (receivables, cancelled-with-money) moves from reports.read to
-- invoices.read in code, so it leaves operations with the invoices themselves.

DELETE FROM role_permissions rp
 USING roles r, permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND r.name = 'operations'
   AND p.name IN ('invoices.read', 'payments.read', 'opex.read');
