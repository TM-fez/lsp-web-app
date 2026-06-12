-- Multi-property structure: Property → Building → Unit.
--
-- Lifestyle is a compound (Village) of several walk-up blocks (J1, J2, J3, I…)
-- plus a separate CBD location. Units belong to a building; a building belongs
-- to a property. Floor is kept as an optional label on the unit (no rigid floor
-- table — floors carry no data of their own).

CREATE TABLE properties (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  code        VARCHAR(50),
  location    TEXT,
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by  UUID         REFERENCES users(id),   -- nullable: migrations seed rows run before any user exists
  updated_by  UUID         REFERENCES users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX properties_name_unique ON properties (lower(name));

CREATE TABLE buildings (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID         NOT NULL REFERENCES properties(id),
  name        VARCHAR(200) NOT NULL,
  code        VARCHAR(50),
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by  UUID         REFERENCES users(id),
  updated_by  UUID         REFERENCES users(id),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- A building name is unique within its property (Village/J1 and CBD/J1 could both exist).
CREATE UNIQUE INDEX buildings_name_per_property_unique ON buildings (property_id, lower(name));
CREATE INDEX buildings_property_idx ON buildings (property_id);

ALTER TABLE rooms
  ADD COLUMN building_id UUID REFERENCES buildings(id),
  ADD COLUMN floor       SMALLINT;
CREATE INDEX rooms_building_idx ON rooms (building_id) WHERE deleted_at IS NULL;

-- Seed the two real properties + a holding building, then park every existing
-- unit under Village → "Unassigned" so nothing is orphaned. Staff reassign each
-- unit to its real block (J1/J2/…) from the Properties screen.
DO $$
DECLARE
  v_village    UUID;
  v_cbd        UUID;
  v_unassigned UUID;
BEGIN
  INSERT INTO properties (name, code, location)
    VALUES ('Village', 'VLG', 'Gaborone') RETURNING id INTO v_village;
  INSERT INTO properties (name, code, location)
    VALUES ('CBD', 'CBD', 'Gaborone CBD') RETURNING id INTO v_cbd;

  INSERT INTO buildings (property_id, name, code)
    VALUES (v_village, 'Unassigned', 'NA') RETURNING id INTO v_unassigned;
  INSERT INTO buildings (property_id, name, code)
    VALUES (v_cbd, 'Main', 'MAIN');

  UPDATE rooms SET building_id = v_unassigned WHERE building_id IS NULL;
END $$;

-- Permissions: admin manages the estate; every operational role can READ so the
-- property filter works for them on the cockpit / lists.
INSERT INTO permissions (name, module) VALUES
  ('properties.read',   'properties'),
  ('properties.create', 'properties'),
  ('properties.update', 'properties'),
  ('buildings.read',    'properties'),
  ('buildings.create',  'properties'),
  ('buildings.update',  'properties')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.module = 'properties'
  WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('properties.read', 'buildings.read')
  WHERE r.name IN ('operations', 'reception', 'accounts', 'maintenance', 'housekeeping')
ON CONFLICT DO NOTHING;
