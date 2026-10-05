-- (R5 owner decision, 2026-10-04) Each staff member's pay is charged to ONE home property.
--
-- Round 4 let a property-limited accountant post payroll for "their" properties. A person
-- who works at both CBD and the Village was then charged in full by the CBD posting AND in
-- full by the Village posting — paid once, costed twice — and the company P&L was off by
-- their whole salary. The proposal in #142, now decided: every staff member has exactly
-- one home property, and their pay is costed there and only there, whoever posts it.
-- Staff with no property at all stay company-level costs (no property).
--
-- The backfill makes today's implicit rule ("first of their properties by name") explicit
-- and stable, so adding a membership later can't silently move someone's cost. An admin
-- can change it on the Payroll screen.

ALTER TABLE staff_compensation
  ADD COLUMN home_property_id UUID REFERENCES properties(id);

UPDATE staff_compensation sc
   SET home_property_id = (
         SELECT up.property_id
           FROM user_properties up
           JOIN properties p ON p.id = up.property_id
          WHERE up.user_id = sc.user_id
          ORDER BY p.name, p.id
          LIMIT 1)
 WHERE sc.home_property_id IS NULL;
