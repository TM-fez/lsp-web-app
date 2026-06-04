INSERT INTO roles (name) VALUES
  ('admin'),
  ('reception'),
  ('operations'),
  ('housekeeping'),
  ('maintenance'),
  ('accounts')
ON CONFLICT (name) DO NOTHING;
