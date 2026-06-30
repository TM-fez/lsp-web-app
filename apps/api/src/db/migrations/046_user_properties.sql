-- User → property access: the membership table the active-property scope is
-- enforced against (Phase 1, multi-property).
--
-- A user sees only the properties they have a row for here. After login they
-- pick one to work in (the "active property"); a user with exactly one is
-- auto-scoped to it. The `admin` role is treated as a wildcard in code (access to
-- every property) and does not depend on rows here.
--
-- Enforcement is server-side: every property-scoped request must carry an
-- X-Property-Id the user is a member of (see core/scope/activeProperty.ts).

CREATE TABLE user_properties (
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id UUID        NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, property_id)
);
CREATE INDEX user_properties_user_idx ON user_properties (user_id);

-- Non-breaking rollout: grant every existing user access to every existing
-- property so nobody loses visibility on deploy. The admin then trims access
-- per user from the Users screen (a later slice). Admin is a wildcard anyway.
INSERT INTO user_properties (user_id, property_id)
  SELECT u.id, p.id FROM users u CROSS JOIN properties p
ON CONFLICT DO NOTHING;
