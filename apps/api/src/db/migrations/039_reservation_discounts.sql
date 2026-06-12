-- Build 2b: per-booking discounts with a manager sign-off.
--
-- Operations can REQUEST a discount on a booking; only an approver (Tameem/admin)
-- can sign it off — no discount applies without approval. The whole thing is
-- recorded (who asked, who approved, why) so it can't be quietly abused.

ALTER TABLE reservations
  ADD COLUMN discount_type       TEXT,        -- 'PERCENT' | 'FIXED'
  ADD COLUMN discount_value      INTEGER,     -- percent points, or thebe for FIXED
  ADD COLUMN discount_reason     TEXT,
  ADD COLUMN discount_requested_by UUID REFERENCES users(id),
  ADD COLUMN discount_approved_by  UUID REFERENCES users(id),
  ADD COLUMN discount_approved_at  TIMESTAMPTZ;

INSERT INTO permissions (name, module) VALUES
  ('reservations.discount.request', 'reservations'),
  ('reservations.discount.approve', 'reservations')
ON CONFLICT (name) DO NOTHING;

-- admin (Tameem): request AND approve.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('reservations.discount.request', 'reservations.discount.approve')
  WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

-- operations + reception: can REQUEST a discount, but it stays pending until a
-- manager approves it.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name = 'reservations.discount.request'
  WHERE r.name IN ('operations', 'reception')
ON CONFLICT DO NOTHING;
