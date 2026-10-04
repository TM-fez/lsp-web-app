-- (Round 4, 2026-10-04) Idempotency keys — safe double-submit for money and create endpoints.
--
-- Why: a double-click, a flaky connection that makes the browser retry, or a second tab can
-- send the SAME "refund P100" / "record payment" / "add cost" / "add guest" request twice. The
-- API had nothing to tell "the same click again" from "a second, deliberate action": four
-- parallel refunds of P100 all succeeded and refunded P400.
--
-- The client now sends an `Idempotency-Key` header (one fresh random key per dialog open). The
-- first request carrying a key does the work and its response is stored here; any later
-- request with the same key (same user, same endpoint) gets that stored response back and
-- does nothing. The same key with a DIFFERENT body is a client bug and is refused (422).
--
-- Only successful (2xx) responses are kept. A request that failed (validation, "not enough
-- left to refund", …) releases its key so the user can correct the form and submit again with
-- the same dialog key.
--
-- `state` = IN_PROGRESS while the first request is still running; a parallel duplicate waits
-- for it and then replays its response. Keys expire after 24 hours (`expires_at`); an expired
-- key is simply re-claimed by the next request. Expired rows are pruned by the API.
--
-- Not an audit table: the money action it protects writes its own audit_logs row in its own
-- transaction (CLAUDE.md invariant 6). This table only remembers "this click was already served".

CREATE TABLE idempotency_keys (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users(id),
  -- "POST /api/v1/invoices/:id/refund" — the route pattern, so one key cannot be replayed
  -- against a different operation.
  endpoint        text        NOT NULL,
  key             text        NOT NULL,
  -- sha-256 of method + route + params + active property + body. Same key, different hash = 422.
  request_hash    text        NOT NULL,
  state           text        NOT NULL DEFAULT 'IN_PROGRESS'
                              CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CONSTRAINT idempotency_keys_unique_per_user_endpoint UNIQUE (user_id, endpoint, key)
);

CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);
