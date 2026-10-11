---
name: lsp-security-audit
description: Source-first security audit of the LSP codebase (Express/Kysely API + React SPA). Use when asked to security-audit, pen-test (from source), or check LSP for vulnerabilities, either the whole app or named areas. Read-only against the code; never touches the live site, Render, Vercel, Booking.com or real data.
---

# LSP security audit

Find vulnerabilities in LSP that cross a **real trust boundary** — an anonymous
guest, a scoped contractor, a staff member limited to some properties, or a role
without a permission — and hand the owner the evidence, a priority and the smallest
fix. A suspicion without a named attacker, a named victim resource and a concrete
outcome is not a finding.

Method adapted from Cloudflare's `security-audit` skill (MIT — see `NOTICE.md`),
cut down and rewritten for this one app.

## Two modes

- **Focused** (default): the user names an area ("check the public booking page",
  "is file upload safe?"). Use the relevant parts of `CHECKS.md`; answer in chat.
  No report files unless asked.
- **Full audit**: the user asks for an audit/pen-test of LSP or a report. Run all
  five phases below and write the report files.

If it isn't clear which, ask one question before starting a full audit. Also ask
the **size**: `quick` (scoped list of areas, one hunting pass) or `standard`
(every area in `SURFACE.md`, a second pass on gaps).

## Safety rules (both modes, non-negotiable)

1. **Read source; don't attack anything.** Never send requests to the deployed API
   (`lsp-api-p3zx.onrender.com`), the Vercel site, Booking.com, email/SMS
   providers, Sentry, or any LLM provider. Never use real credentials, tokens or
   the production `DATABASE_URL`.
2. **Local proof only, with dummy data.** If a finding needs running code to prove
   it, the only allowed targets are: the unit/live-DB/e2e test suites against the
   `lsp_test` database from `infra/docker-compose.test.yml`, or a new test file
   written for the purpose under a scratch directory. No network installs. If
   docker or the test DB isn't available, mark the finding `needs_validation` and
   write the plan — don't improvise against another database.
3. **Minimum effect.** Stop at the smallest local result that proves the defect.
   No load or availability testing beyond reasoning about limits in code.
4. **No fixes during the audit.** The audit reports. Fixes go through normal
   `fix/…` PRs afterwards, one finding (or tight group) per PR, with a test that
   fails before the fix.
5. **Secrets never go in the report.** Name the variable (`JWT_PRIVATE_KEY`),
   never its value, even a test one.

## Output location (full audit)

Write to `<scratchpad>/security-audit/run-<N>/` (the session scratchpad; next
unused N). Never inside the repo working tree unless the user asks — and then
only under a git-ignored path. At the end, send the user `REPORT.md` and offer to
publish it as a private page.

Files:
- `run.md` — commit SHA, dirty or clean, mode, size, areas in scope, date.
- `map.md` — Phase 1 output.
- `ledger.md` — the coverage list: one row per area × check, with status
  `covered` / `candidate` / `blocked` / `out_of_scope` / `deferred` and a one-line
  note of what was actually read (files + functions).
- `findings.md` — every candidate with its verdict (see `REPORTING.md`).
- `REPORT.md` — the owner-facing report.

## Phase 1 — Map (do this yourself, don't delegate)

Read `SURFACE.md`, then **re-check it against the code** — it's a snapshot and
the code wins. At minimum:
- `apps/api/src/router.ts` and every `*.routes.ts`: list each route with its
  middleware chain. Flag any route whose chain differs from
  `authenticate → authorize → [requireActiveProperty / inProperty] → validateBody`
  and any route mounted without `authenticate`.
- `apps/api/src/app.ts`: helmet, CORS, global rate limit, `trust proxy`, body
  size limits, error handler.
- `apps/api/src/config/env.ts`: which secrets exist and their fallbacks/defaults.
- `apps/web/vercel.json`: rewrites and headers.
- `docs/GAP-REGISTER.md`, `ROADMAP.md` (H1–H7) and `WORKLOG.md`: what was already
  found and fixed. A finding that re-opens a fixed issue is a **regression** —
  say so and cite the original.

Write `map.md` (trust boundaries, who the principals are, every entry point) and
build `ledger.md` from `CHECKS.md` × the areas in scope.

## Phase 2 — Hunt

Work the ledger one area at a time. For each check: read the actual code path end
to end (route → controller → service → repository → SQL), not just the file named
in the ledger. Record in the ledger what you read. A check is `covered` only when
you can name the functions that make it safe.

In `standard` size you may delegate areas to sub-agents (Agent tool,
`Explore`/`general-purpose`), one area each, with the safety rules pasted in and
told to return candidates, not edit anything. Keep `ledger.md` and `findings.md`
yourself — sub-agents never write them. In `quick` size, do it yourself.

After the pass, re-read the ledger as a critic: which entry points from `map.md`
have no rows? Which rows say `covered` with a vague note? In `standard`, run a
second pass on those. In `quick`, mark them `deferred` and list them in the
report — never imply coverage you didn't do.

## Phase 3 — Try to disprove every candidate

For each candidate, start fresh (in `standard`, a new sub-agent that did not find
it) and try to prove it **wrong**: is there a middleware, a DB constraint, a
`WHERE` clause, a Zod schema, a trigger, or a later check that blocks it? Does the
attacker actually hold the access the path needs? Check DB constraints and
triggers in `apps/api/src/db/migrations/` — a lot of LSP's safety lives there.

Outcomes: `confirmed` (full trace, attacker → effect, nothing blocks it),
`needs_validation` (one exact fact can't be settled from source — state it),
`rejected` (say what blocks it). Keep rejected ones — they show coverage.

## Phase 4 — Prove locally where cheap

For `confirmed` medium+ findings, write a failing test if it's cheap (an
integration test against `lsp_test`, following `apps/api/tests/` layout). Keep it
in the scratch run directory, not the repo. If it's not cheap, the source trace
stands on its own.

## Phase 5 — Report

Follow `REPORTING.md`. Re-read every `confirmed` finding's file/line references
against the current code before finishing — line numbers drift.

## Anti-patterns

- Reporting "missing best practice" with no attacker and no victim.
- Calling something an IDOR without checking `propertyScope` / `contactScope` /
  `inProperty` and the repository's `WHERE`.
- Flagging Kysely queries as SQL injection — check for `sql.raw`, `sql.lit`,
  `sql.ref`/`sql.id` with user input, and string-built `sql\`\`` fragments instead.
- Treating an owner decision in `CLAUDE.md` as a bug (e.g. unpaid PENDING check-in
  is allowed — invariant 3). If a decision has a security cost, report it as a
  👤 "Your call" item, not a defect.
- Severity by vibes. Use the rubric in `REPORTING.md`.
