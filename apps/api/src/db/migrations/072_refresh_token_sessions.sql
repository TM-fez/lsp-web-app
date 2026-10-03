--
-- (H7) Sessions that end when they are ended.
--
-- Why: the access token is a self-contained 15-minute JWT and nothing re-checked it, so
-- logging out, being deactivated or being demoted left the old token working for up to
-- 15 minutes. Logout only revoked the refresh cookie.
--
-- A login now starts a SESSION, and every rotated refresh token for that login carries the
-- same session_id. The access token names it (claim `sid`), and `authenticate` accepts the
-- token only while that session still has a live (unrevoked, unexpired) refresh token — so
-- logout, "log out everywhere" and deactivation take effect on the next request.
--
-- Existing rows are their own session (session_id = id): sessions already open keep
-- working until their refresh token is next rotated, which carries the id forward.

ALTER TABLE refresh_tokens ADD COLUMN session_id uuid;
UPDATE refresh_tokens SET session_id = id WHERE session_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN session_id SET NOT NULL;
CREATE INDEX refresh_tokens_session_live_idx ON refresh_tokens(session_id) WHERE revoked = false;
