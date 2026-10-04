-- (Re-test 2026-10-04) Refresh-token reuse detection.
--
-- Each refresh rotates the token: the old one is revoked and a new one issued in the same
-- login session (H7). If a REVOKED token is presented again, someone else has a copy —
-- the classic sign of a stolen cookie — and the safe response is to end that whole
-- session, so neither the thief's nor the user's copy keeps working (the user simply
-- signs in again). Until now a reused token was just refused, and the thief's rotated
-- copy lived on.
--
-- `revoked_at` lets the check tell theft from a harmless race: two browser tabs that
-- refresh at the same moment both present the same token, and the second arrives a few
-- seconds after the first revoked it. Only a reuse well after revocation ends the session.

ALTER TABLE refresh_tokens ADD COLUMN revoked_at timestamptz;
