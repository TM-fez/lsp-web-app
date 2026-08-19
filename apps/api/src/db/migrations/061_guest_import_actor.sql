-- Service actor for the one-off guest import (DATA SEED — no schema change).
--
-- The Little Hotelier export is loaded by `db:import-guests`, a CLI tool with no logged-in
-- user, but contacts.created_by / updated_by are NOT NULL and every row it writes must carry
-- an audit_logs entry naming *someone*. Migration 047 set the precedent with "Channel Sync";
-- reusing that actor here would attribute ~1,300 CRM contacts to the Booking.com importer and
-- make the audit trail read wrong, so the import gets its own actor with a FIXED id that the
-- script references as a constant (import-guests.ts: IMPORT_USER_ID).
--
-- Non-login, exactly like 047: active = false and an unusable password hash ('!', which bcrypt
-- can never match), so it can never authenticate. Idempotent (ON CONFLICT (id) DO NOTHING).

INSERT INTO users (id, role_id, name, email, password_hash, active)
SELECT '00000000-0000-4000-a000-000000000003', r.id, 'Data Import', 'data-import@system.lsp', '!', false
FROM roles r
WHERE r.name = 'admin'
ON CONFLICT (id) DO NOTHING;
