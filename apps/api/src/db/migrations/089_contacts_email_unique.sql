-- (R6 NEW-4) One guest per email — unless someone deliberately said "they share it".
--
-- R5 made a second guest with an email already in use a question ("Save anyway"), but the
-- check ran BEFORE the insert: six parallel saves of the same new email made two guests.
-- Only the database can settle that race, so:
--
--   email_shared  true when a person deliberately saved a shared email (a family, a company's
--                 travel desk) — the R5 "Save anyway" — or the public /stay page filed a
--                 booking under a new record because the email belongs to someone else (R6
--                 NEW-5). Recorded on the row, so the override is in the audit trail (NEW-2).
--
-- and a unique index on lower(email) over live contacts that did NOT opt out. The loser of
-- a race gets the same 409 question as before.
--
-- Backfill: emails already shared today keep their OLDEST record as the unique one; the
-- rest are marked shared, so the index can be built without touching anyone's data.

ALTER TABLE contacts ADD COLUMN email_shared BOOLEAN NOT NULL DEFAULT false;

UPDATE contacts c
   SET email_shared = true
 WHERE c.deleted_at IS NULL
   AND c.email IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM contacts o
      WHERE o.deleted_at IS NULL
        AND lower(o.email) = lower(c.email)
        AND (o.created_at, o.id) < (c.created_at, c.id)
   );

CREATE UNIQUE INDEX contacts_email_unique
  ON contacts (lower(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL AND NOT email_shared;
