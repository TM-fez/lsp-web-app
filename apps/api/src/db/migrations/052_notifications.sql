-- Phase 2: Notifications infrastructure — the shared in-app alert channel that later
-- powers maintenance/housekeeping alerts, reminders, and AI nudges.
--
-- One row PER RECIPIENT (fan-out at emit time). A notification meant for three
-- people is three rows, so read/unread state (`read_at`) is naturally per-user and
-- a recipient only ever queries `WHERE user_id = me` — no join, no leak across
-- properties. `property_id` carries context (NULL = company-wide).
--
-- `dedup_key` is how the interval-reminder sweep stays idempotent: a generator emits
-- a stable key (e.g. `checkout_due:<userId>:<reservationId>:<date>`) and re-runs
-- insert `ON CONFLICT DO NOTHING`, so the same reminder is never delivered twice.
-- Ad-hoc notifications leave it NULL (many NULLs are allowed under a UNIQUE index).

CREATE TABLE notifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  property_id  UUID                 REFERENCES properties(id) ON DELETE SET NULL,
  type         VARCHAR(64)  NOT NULL,            -- e.g. 'maintenance.assigned', 'reminder.checkout_due'
  title        VARCHAR(200) NOT NULL,
  body         TEXT,
  entity_type  VARCHAR(64),                      -- deep-link target table, e.g. 'reservations'
  entity_id    UUID,                             -- deep-link target id
  link         VARCHAR(300),                     -- optional web path, e.g. '/reservations/<id>'
  dedup_key    VARCHAR(200),                     -- stable key for idempotent reminders (NULL = ad-hoc)
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The bell: unread count + newest-first list, both scoped to one recipient.
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_user_recent_idx ON notifications (user_id, created_at DESC);

-- Idempotency for the reminder sweep. Partial UNIQUE so ad-hoc (NULL) rows don't collide.
CREATE UNIQUE INDEX notifications_dedup_key_idx ON notifications (dedup_key) WHERE dedup_key IS NOT NULL;
