--
-- (P7) Settings — the business details and rules that only a developer could change.
--
-- Why: the company name on invoices was a constant in the web app, there was no VAT number
-- or bank details on any invoice, and payment terms / the website-booking hold were
-- environment variables. The owner can now set all of them from Admin → Settings.
--
-- ONE row (id = 1, enforced by the CHECK). Every column is nullable: NULL means "not set",
-- and the code falls back to today's behaviour — the built-in name, INVOICE_TERMS_DAYS,
-- WEBSITE_PENDING_TTL_HOURS — so deploying this changes nothing until someone edits it.

CREATE TABLE app_settings (
  id                   smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name         text,
  company_address      text,
  company_phone        text,
  company_email        text,
  vat_number           text,
  bank_name            text,
  bank_account_name    text,
  bank_account_number  text,
  bank_branch_code     text,
  invoice_footer       text,
  invoice_terms_days   integer CHECK (invoice_terms_days BETWEEN 0 AND 90),
  website_hold_hours   integer CHECK (website_hold_hours BETWEEN 1 AND 168),
  updated_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (name, module) VALUES
  ('settings.read', 'settings'),
  ('settings.update', 'settings')
ON CONFLICT (name) DO NOTHING;

-- Admin holds every permission by convention; nobody else edits the business's details.
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r
  JOIN permissions p ON p.name IN ('settings.read', 'settings.update')
  WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;
