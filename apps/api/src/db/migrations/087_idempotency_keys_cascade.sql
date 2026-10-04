-- (R5 retest) Idempotency keys go with their user.
--
-- Since R5 every money-moving POST leaves a short-lived row here even without an
-- Idempotency-Key header (the request's own fingerprint, kept 10 seconds), so these rows now
-- exist for nearly every user who has taken a payment. They are a replay cache, not a
-- record — the audit log is the record — so they must never stop a user row from being
-- removed (test fixtures do this; production soft-deletes users). Cascade instead of block.

ALTER TABLE idempotency_keys
  DROP CONSTRAINT IF EXISTS idempotency_keys_user_id_fkey,
  ADD CONSTRAINT idempotency_keys_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
