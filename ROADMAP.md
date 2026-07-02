# LSP Web App — Roadmap & Delivery Plan

Companion to `HANDOVER.md`. `HANDOVER.md` = how to run + where the project stands.
This file = the full backlog of what's left to build, plus the order to build it in.

Status legend: 🆕 not started · 🟡 partial (foundation exists) · 🔒 blocked on client · 🧹 cleanup/tech-debt · ✅ done

---

## Part 1 — Full backlog

### A1. Multi-property access / property picker  *(the keystone)*
- 🟡 Property → Building → Unit structure — exists (migration 040; Village + CBD seeded)
- 🟡 Property filter on cockpit/reservations — exists but **UI-only; server trusts the client**
- 🆕 `user_properties` permissions table (user → property mapping)
- 🆕 Server-side scoping enforced on **every** query (shared middleware + helper, rolled module-by-module)
- 🆕 Property picker as a post-login step (authority users) + auto-scope (single-property users, no picker)
- 🆕 Active-property carried server-side (JWT claim vs validated header — **decision pending**)
- 🆕 Per-property apartment naming (room `code` is globally unique today → scope uniqueness per building/property)

### A2. Maintenance
- 🟡 Module + contractor costs/expenses + completion/approval accountability — exists (024/037/038)
- 🆕 Scoped service-provider login (new contractor role; portal limited to their tickets)
- 🆕 In-app pop-up notifications (pending/unassigned) — **no notifications infra exists yet**
- 🆕 Automated interval reminders for overdue/pending (reuse cron pattern)
- 🆕 wa.me WhatsApp follow-up button (frontend deep link; staff sends from own phone)
- 🆕 L&P-unit vs third-party-landlord financial mapping (current accountability = who-did/who-approved, not owner attribution)

### A3. Housekeeping
- 🟡 Module — exists (032)
- 🆕 Three-stage flow: Routine Checks → Supervisor validation → Property Manager sign-off (status workflow + schema)
- 🆕 Compliance checklists with turnaround tracking (new tables)
- 🆕 Tablet view — live room status + tasks (responsive/PWA view, not a separate app)

### A4. Reservations / CRM
- 🆕 New fields: booking coordinator (corporate vs individual) + assigned billing/accounts contact
- 🆕 AI target marketing — segment premium customers, auto-generate group campaigns (LLM)
- 🔒 OTA guest details — Fahad decides: manual Extranet copy (no build) vs full Reservations API (separate approval)
- ✅ Booking.com via iCal — already solved

### A5. Dashboards
- 🟡 `reports` + `dashboard` modules — exist to build on
- 🆕 Financial Cockpit — real-time outstanding ledger balances + receivables
- 🆕 Operational Cockpit — occupancy %, monthly/annual comparative trends
- 🆕 AI Strategy Engine — prompt AI on dashboard trends → auto-generate campaigns (shares A4's LLM)

### A6. OTA-to-direct conversion
- 🟡 `/stay` public booking page + `checkins` module — exist
- 🆕 In-apartment QR code → check-in / checkout asks → post-stay follow-up
- 🆕 Feed captured guests into CRM + AI marketing (A4/A5)

### B. Pre-existing unfinished work
- 🔒🆕 **Phase B — real DPO Pay gateway** (replace simulated confirm; blocked on client sandbox keys). `settlePaid()` is the sole CONFIRM writer; `/stay` bookings have no hold → must generalise to confirm hold-less reservations.
- 🆕 Wire approved discount into the actual gateway charge (today only reduces displayed amount due)
- 🆕 `reservations.source = WEBSITE` column + surface origin (today only inferred via system user + note)
- 🆕 WhatsApp → Leads auto-capture; lead → reservation conversion; retention/reviews; lease-renewal workflow
- 🧹 Wipe leftover demo contacts / reservations / leads before pilot
- 🧹 Deactivate the now-empty "Main" building under CBD
- 🧹 Rewrite `DEPLOY.md` (predates the Vercel-web + Render-API split)
- 🧹🔒 Render free Postgres expires ~Sep 2026 → move to paid; free web service sleeps when idle
- 🧹 Clean up abandoned Vercel "-api" projects

### C. Cross-cutting dependencies (build once, used by many)
- 🆕 **Notifications infrastructure** — needed by A2, A3
- 🆕 **Claude/LLM integration** — shared by A4, A5, A6
- 🆕 **Multi-property scoping (A1)** — the keystone everything else scopes through

---

## Part 2 — Delivery plan (the order)

**Guiding principle:** build foundations before the features that depend on them, so scoping/
notifications/AI are inherited for free instead of retrofitted. Client-blocked items run on a
parallel track and slot in whenever the client unblocks them.

### Phase 0 — Quick wins (low risk, clears the deck)
Small, independent, no dependency on the keystone. Ships momentum.
- ✅ `reservations.source` column (enum + backfill) + surfaced in form/list/cockpit — migration 045
- ✅ wa.me WhatsApp button — built reusable (`WhatsAppButton` + `whatsapp.ts`), wired into the **guest** drawer.
  - ⏳ Follow-up: leads + maintenance have no phone to dial yet (leads UI doesn't surface the contact phone; maintenance has no contractor phone field). Add those phone fields, then drop the same button in.
- ✅ `DEPLOY.md` rewrite (Vercel-web + Render-API + Render-Postgres; in-process sweep)
- ⏸️ Parked: go-live data wipe (needs a deliberate DB target + owner eyeball before firing) + deactivate empty "Main" building

### Phase 1 — The keystone: multi-property scoping (A1)
Everything downstream gets scoped through this, so it goes first.
- `user_properties` table + active-property mechanism (decide JWT claim vs validated header)
- Shared scoping middleware/helper; roll out reservations → cockpit → every other module
- Property picker (authority) + auto-scope (single-property); per-property apartment naming

### Phase 2 — Shared infrastructure
Unblocks the operations + AI features that follow.
- ✅ Notifications infrastructure (in-app + interval reminders via cron) — per-recipient
  `notifications` table (052), `notifications` module with a reusable `notify()` emit helper
  (fan-out to a user / list / whole property), read-model API (list, unread-count, read,
  read-all), Topbar bell + dropdown, and a secret-guarded `GET /cron/reminders` sweep with
  idempotent generators (checkouts-due, stale high-priority repairs). Follow-up: narrow
  reminder targeting from "all property members" to the responsible department once Phase 3
  role mapping lands.
- ✅ Claude/LLM integration scaffolding (one client, used by A4/A5/A6) — `core/llm/llm.service.ts`
  via the official `@anthropic-ai/sdk` (default model `claude-opus-4-8`), `isLlmConfigured()` gate +
  `generateText()`. DARK until `ANTHROPIC_API_KEY` is set; no product code calls it yet (a seam for A4/A5/A6).

**Phase 2 COMPLETE** — notifications (#54) + LLM client (#55) both merged.

### Phase 3 — Operations depth (rides on Phase 1 + 2)
- Maintenance (A2): scoped contractor login, notifications, reminders, L&P-vs-landlord mapping
- Housekeeping (A3): three-stage flow, compliance checklists, tablet view

### Phase 4 — Revenue & intelligence (rides on Phase 1 + 2)
- Reservations/CRM new fields (A4)
- Dashboards: Financial + Operational Cockpit (A5)
- AI target marketing + AI Strategy Engine (A4/A5)

### Phase 5 — OTA-to-direct (rides on /stay + A4/A5)
- In-apartment QR → check-in/checkout asks → post-stay follow-up → CRM + AI marketing

### Parallel track — client-gated (slot in whenever unblocked)
- 🔒 Phase B DPO payments + discount-into-charge — **PARKED by owner decision (2026-07-02)**;
  registration was deliberately stopped (reason to be re-confirmed before ever resuming)
- 🔒 OTA guest details (when Fahad decides manual vs Reservations API) — interim answer now
  planned as H4/H6 below (claim flow + email enrich), which need no Booking.com approval
- 🔒 Render Postgres → paid (before real daily use; hard deadline ~Sep 2026) — also a
  prerequisite for H4 channel-sync go-live (free service sleeps; OTA fetches time out)

---

## Part 3 — Hardening track (H1–H6)

From the full app review of 2026-07-02 (bugs-in-waiting + do-better items), bundled into
phases. Runs alongside Part 2: H1–H3 first (fast, everything leans on them), H4 whenever
the client is ready to switch Booking.com sync on, H5 alongside product Phase 3, H6 à la
carte. **DPO is out of scope for this track** (parked, see above).

### Phase H1 — Stop the bleeding *(live defects; ~2–3 days, one PR, no client dependency)*
**DONE (2026-07-02)** — new env vars: `TRUST_PROXY_HOPS` (render.yaml sets 2),
`WEBSITE_PENDING_TTL_HOURS` (default 24; 0 disables), `RATE_LIMIT_REFRESH_MAX` (default 30).
- ✅ `trust proxy` in `app.ts` — env-driven hop count (`TRUST_PROXY_HOPS`, prod = 2 for
  Vercel→Render) so per-IP rate limits + audit-log IPs see the real client, not the proxy.
  ⏳ Follow-up: verify `req.ip` on live after deploy.
- ✅ Auto-expire unpaid WEBSITE `PENDING` reservations — `reservations.expiry.ts`, third
  sweeper in the sweep (interval + `/cron/sweep`): cancels after the TTL with an audit row
  and a `reservation.website_expired` notification to the property; race-guarded so a
  just-confirmed booking is left alone. Staff-created PENDING is untouched.
- ✅ Auth tidy-ups: well-formed dummy bcrypt hash (timing parity actually works), rate
  limit on `/auth/refresh`, plus a per-ACCOUNT login limiter (keyed by email) that holds
  even if X-Forwarded-For is spoofed past the trust boundary.
- ✅ `BLOCKED` in the web `ReservationStatus` union + tone/label maps ("OTA block",
  violet), in the reservations filter, and excluded from edit/cancel (`isOpen`).

### Phase H2 — Don't lose data *(~3–4 days + one client decision)*
**Code DONE (2026-07-02)** — the two 🔒 owner steps below remain.
- ✅ S3-compatible storage driver — `files.storage.ts` (`S3StorageDriver` via
  `@aws-sdk/client-s3`, works with R2/B2/AWS), `createStorageAdapter()` honours
  `STORAGE_DRIVER` (the router previously hardcoded local `./uploads`); dedupe now
  verifies the binary exists before skipping the write, and rows record the ACTIVE
  driver/bucket. Downloads stream through the API in both drivers (bucket stays private).
- ✅ Nightly `pg_dump` backup — `.github/workflows/db-backup.yml` (01:30 UTC + manual
  trigger), compressed custom-format dump → S3-compatible bucket, INERT until the
  `BACKUP_*` repo secrets are set; retention via bucket lifecycle rules (the job has no
  delete permissions on purpose). Restore command documented in the workflow header.
- ✅ Retention — `core/retention.ts`, 4th leg of the sweep, self-gated to once/day:
  dead refresh tokens pruned after `REFRESH_TOKEN_RETENTION_DAYS` (default 30);
  `audit_logs` pruning STRICTLY OPT-IN (`AUDIT_LOG_RETENTION_DAYS` default 0 = forever).
- 🔒 Owner: create the R2/B2 bucket + set Render `STORAGE_*`/GitHub `BACKUP_*` secrets
  (render.yaml + workflow both document the exact keys), then flip `STORAGE_DRIVER=s3`.
- 🔒 Owner: Render → paid plan (service must stop sleeping before H4).

### Phase H3 — Eyes and guardrails *(~3–4 days)*
**Code DONE (2026-07-02)** — two 🔒 owner steps below.
- ✅ Sentry on API (`SENTRY_DSN`) + web (`VITE_SENTRY_DSN`) — errors only (no tracing,
  free-tier friendly), 4xx AppErrors not reported, DARK until the DSNs are set.
- ✅ Structured logging — `core/logger.ts` (pino; JSON in prod, pretty in dev, quiet in
  tests) + a hand-rolled per-request log line (`requestLog.middleware.ts`) tagged with
  the existing request id; errorHandler now logs unexpected (non-AppError) errors.
  (pino-http was tried and dropped — its global `req.id` re-typing broke 16 controllers.)
- ✅ CI — already existed (correction to the review!); patched: runs the cockpit e2e
  suite, seeds the DB, `BCRYPT_ROUNDS=4`, and triggers on PRs against ANY base branch
  (stacked PRs were skipped before).
- ✅ Security headers on the Vercel app — CSP (`script-src 'self'`), nosniff,
  frame-ancestors 'none', referrer + permissions policies.
- ✅ Token-storage decision (documented in `store/auth.ts`): keep localStorage. An XSS
  can mint fresh tokens via same-origin `/auth/refresh` regardless of where the token
  sits, so memory-only buys nothing — the real defence is the CSP + 15-min expiry.
- 🔒 Owner: create the Sentry account/projects (sentry.io, free) → set `SENTRY_DSN`
  (Render) + `VITE_SENTRY_DSN` (Vercel).
- 🔒 Owner: uptime monitor on `https://lsp-api-p3zx.onrender.com/health` (UptimeRobot
  free, 5-min interval — side benefit: pings keep the free Render service awake).

### Phase H4 — Channel-sync go-live package *(~1.5–2 weeks; needs H2's paid Render)*
- 🆕 Channel admin UI: per-unit export URL (copy button), edit `booking_ical_url`, rotate
  `ical_token` — today both are DB-only (go-live would mean 25 manual SQL updates).
- 🆕 Import hardening: empty-feed mass-cancel guard, pg advisory lock against overlapping
  runs, skip unchanged block writes, validate import URLs (https + booking.com host).
- 🆕 OTA contact info, Tier 0: keep the feed's SUMMARY (parse DESCRIPTION too, for Airbnb
  later) on the block instead of discarding it.
- 🆕 OTA contact info, Tier 1 — **"Claim this booking"**: staff copy guest details from the
  Booking.com extranet/Pulse app → real contact linked, block becomes check-in-able (needs
  a deliberate status decision so the `settlePaid()`-only-CONFIRMED invariant survives).
  Unblocks: arrivals rail, check-in, invoicing, CRM for OTA guests (all impossible today).
- 🆕 Mount `/cron/channel-sync` + 15-min trigger, then the owner-run go-live checklist in
  HANDOVER §5 (backup → verify migrations → **extranet URL exchange (owner has the
  Booking.com login)** → `CHANNEL_ALERT_EMAIL` → enable trigger).

### Phase H5 — Finish the security rollout *(~1 week; can ride alongside product Phase 3)*
- 🆕 Property scoping extended to the money-loop first (quotes, holds, payments, invoices,
  checkins, availability), then expenses/payroll/files/activity — only reservations,
  cockpit, rooms, maintenance, housekeeping (+ reports/opex id-filters) are scoped today.
- 🆕 Files module cleanup: `AppError`s (disallowed MIME is a 500 today), owner/property
  filtering on list, drop the `as any`, stop hardcoding `/tmp`.
- 🆕 Deliberate call on the ungated `GET /users/directory` (any logged-in user can list staff).

### Phase H6 — Do-better / revenue *(~1–2 weeks, à la carte)*
- 🆕 OTA contact info, Tier 2: parse Booking.com's new-booking notification emails (Brevo
  inbound) → auto-attach guest details to the matching block; Tier 1 becomes the fallback.
- 🆕 Booking-source badges across cockpit/reservations UI (column exists, UI doesn't show it).
- 🆕 "Manage my booking" link in guest confirmation emails (dates, invoice, WhatsApp button).
- 🆕 Rule-based occupancy/pricing nudges on the dashboard (pre-AI version of A5).
- 🧹 Go-live cleanups already listed in Part 1B: demo-data wipe, empty "Main" building,
  DEPLOY.md rewrite.
