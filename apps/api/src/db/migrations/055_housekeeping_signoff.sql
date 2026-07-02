-- Phase 3 (A3): the three-stage housekeeping flow.
--
--   Stage 1  Routine Checks        cleaner starts + does the turn   housekeeping.update
--   Stage 2  Supervisor validation lead/supervisor inspects         housekeeping.inspect (036)
--   Stage 3  PM sign-off           property manager makes it READY  housekeeping.signoff (NEW)
--
-- The statuses already model the three gates (OPEN → CLEANING → INSPECTED →
-- DONE); what was missing is (a) the final gate being a MANAGER action — until
-- now any cleaner with housekeeping.update could mark a unit READY — and
-- (b) per-stage accountability: WHO cleaned, WHO validated, WHO signed off.

ALTER TABLE housekeeping_tasks
  ADD COLUMN started_by    UUID REFERENCES users(id),
  ADD COLUMN inspected_by  UUID REFERENCES users(id),
  ADD COLUMN signed_off_by UUID REFERENCES users(id);

INSERT INTO permissions (name, module) VALUES
  ('housekeeping.signoff', 'housekeeping')
ON CONFLICT (name) DO NOTHING;

-- Property managers: admin + operations. Deliberately NOT reception and NOT the
-- base housekeeping role — the sign-off is the management gate. (A head
-- housekeeper can still be granted it per-user via user_permissions.)
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'housekeeping.signoff'
  WHERE r.name IN ('admin', 'operations')
ON CONFLICT DO NOTHING;
