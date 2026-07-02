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
- ✅ Scoped service-provider login — `contractor` role (053) with the narrow
  `maintenance.read`/`maintenance.work`/`maintenance.complete` + files (photos) set; list is
  pinned to their own tickets server-side, foreign tickets 404 by id, staff-only mutations
  (edit/assign/cost/cancel/approve) stay 403. Contractors are excluded from property-wide
  notification fan-outs (direct alerts only). Create is now scope-gated (room must be in the
  active property — the dormant check is armed).
- ✅ In-app pop-up notifications (pending/unassigned) — `maintenance.opened` (property fan-out,
  actor excluded, unassigned flagged) + `maintenance.assigned` (direct to the assignee) emitted
  from the maintenance service; the web bell now also toasts newly arrived notifications
- ✅ Automated interval reminders for overdue/pending — `reminder.maintenance_unassigned`
  (any-priority OPEN with nobody assigned > 1 day, nagged daily) joins the existing stale-repair
  generator; the reminder sweep now runs **in-process daily** (retention-style self-gate), so
  `/cron/reminders` is just the serverless fallback like `/cron/sweep`
- 🆕 wa.me WhatsApp follow-up button (frontend deep link; staff sends from own phone)
- ✅ L&P-unit vs third-party-landlord financial mapping — per-room `ownership`
  (LIFESTYLE default / LANDLORD + landlord name & wa.me-able phone, migration 054), set in
  the unit drawer; the Expenses money view gains a "Unit owner" column and the maintenance
  drawer flags landlord units (with a WhatsApp button), so every repair bill is attributable
  to the right owner

### A3. Housekeeping
- 🟡 Module — exists (032)
- ✅ Three-stage flow: Routine Checks → Supervisor validation → Property Manager sign-off —
  the INSPECTED→READY gate is now a manager action (`housekeeping.signoff`, migration 055,
  admin+operations; grantable per-user via the second-hat mechanism), and each stage stamps
  who did it (`started_by`/`inspected_by`/`signed_off_by`); the web queue gates each button
  by its stage permission ("Sign off" replaces "Mark ready")
- ✅ Compliance checklists with turnaround tracking — manager-curated cleaning standard
  (`housekeeping_checklist_items`, seeded with 8 defaults, migration 056) + per-turn ticks
  (`housekeeping_task_checks`); **inspect is blocked (409) until every active item is ticked**;
  cleaners tick from a checklist dialog while the unit is CLEANING; avg DIRTY→READY turnaround
  (last 30 days) on the housekeeping dashboard via `GET /housekeeping/turnaround`
- ✅ Tablet view — `/housekeeping/board`: a chrome-less full-screen live board (polls 20s)
  grouping every unit by stage with touch-sized, permission-gated action + checklist buttons;
  installable via a web-app manifest (`start_url` = the board) so the housekeeping tablet
  pins it to the home screen — a view of the same app, not a separate one

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
  idempotent generators (checkouts-due, stale high-priority repairs). Follow-up ✅ done in
  Phase 3: stale-repair reminders now go straight to the assignee when there is one (property
  fan-out only when ownerless).
- ✅ Claude/LLM integration scaffolding (one client, used by A4/A5/A6) — `core/llm/llm.service.ts`
  via the official `@anthropic-ai/sdk` (default model `claude-opus-4-8`), `isLlmConfigured()` gate +
  `generateText()`. DARK until `ANTHROPIC_API_KEY` is set; no product code calls it yet (a seam for A4/A5/A6).

**Phase 2 COMPLETE** — notifications (#54) + LLM client (#55) both merged.

### Phase 3 — Operations depth (rides on Phase 1 + 2) — ✅ COMPLETE
- Maintenance (A2): notifications + reminders (in-process daily sweep),
  scoped contractor login, L&P-vs-landlord ownership mapping
- Housekeeping (A3): three-stage flow, compliance checklists + turnaround, tablet board

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

### Phase H4 — Channel-sync go-live package *(needs H2's paid Render before the flip)*
**Code DONE (2026-07-02)** — go-live is now purely the owner checklist below.
- ✅ Channel admin UI — "Channel sync" section in the unit drawer: export URL + copy
  button (served via the stable Vercel origin), Booking.com import-URL input (validated
  server-side: https + booking.com host only — the importer can never be pointed at an
  arbitrary endpoint), and a confirm-guarded "rotate export link" action.
  API: `PATCH /rooms/:id/channel`, `POST /rooms/:id/channel/rotate-token` (rooms.update).
- ✅ Import hardening — pg advisory lock (overlapping runs no-op with `ran:false`),
  empty-feed + mass-cancel prune guards (≥3 AND >50% vanishing = broken feed, keep
  blocks + warn), unchanged events skip the write entirely (no 15-min WAL churn).
- ✅ OTA contact info Tier 0 — the feed's SUMMARY/DESCRIPTION (Airbnb puts a reservation
  URL + phone-last-4 there) is kept on the block's notes instead of discarded.
- ✅ OTA contact info Tier 1 — **"Claim this booking"** on a BLOCKED row: GuestPicker →
  `POST /reservations/:id/claim` → real contact attached, status → CONFIRMED. This is
  the documented SECOND sanctioned writer of CONFIRMED (OTA payment is already
  guaranteed, nothing for LSP to collect). Source stays BOOKING_COM (no export
  feedback loop). Importer respects claimed rows: feed moves their dates only; a
  checked-in guest is NEVER auto-cancelled; vanished claimed bookings only warn.
- ✅ `/cron/channel-sync` mounted (secret-guarded; refuses all callers until
  `CRON_SECRET` is set — mounting is inert, the SCHEDULE is the switch).
- 🔒 **Owner go-live checklist, in order:** (1) Render → paid (H2) — Booking.com's
  fetcher times out on a sleeping free service; (2) back up the DB (or trust the H2
  nightly); (3) per unit, in the unit drawer: copy our export URL → paste into the
  extranet, copy their .ics URL → paste into the drawer; (4) set `CHANNEL_ALERT_EMAIL`
  + `CRON_SECRET` on Render; (5) add the 15-min trigger (Render Cron Job / GH Action:
  GET `/api/v1/cron/channel-sync`, header `Authorization: Bearer <CRON_SECRET>`).

### Phase H5 — Finish the security rollout *(~1 week; can ride alongside product Phase 3)*
**Code DONE (2026-07-02).**
- ✅ Property scoping on the money-loop — shared `core/scope/propertyOf.ts` resolvers
  (entity → room → building → property, one query each) + route guards, applied to
  **holds, payments, invoices, checkins, availability**: lists filter to the active
  property (SQL EXISTS via the FK chain), by-id routes 404 outside it (existence is
  not leaked), creates validate body references (`hold_id`/`room_id`/`reservation_id`).
- ✅ DELIBERATE: **quotes stay unscoped** — a quote references a rate plan + unit type,
  never a room, so it has no property to scope to. It becomes scoped the moment it
  turns into a hold.
- ✅ Files module cleanup: `AppError`s (bad MIME/size → 400, missing file → 404, lost
  binary → clear 404 instead of a 500), `os.tmpdir()`, `as any` casts removed, and the
  list now shows **uploaders their own files; admins everything**.
- ✅ DELIBERATE: `GET /users/directory` stays open to all signed-in staff (documented
  in users.routes) — it powers assign-to pickers and returns only id/name/role/is_lead.
- ⏳ Deferred with rationale: **expenses/payroll/activity** stay property-unscoped for
  now — payroll is an org-wide Accounts function, the activity feed is deliberately
  shared "what's changed" (Build 2c), and expenses ride on maintenance orders (scoped
  at the maintenance layer). Revisit if a second operator company ever shares the DB.

### Phase H6 — Do-better / revenue *(à la carte)*
**Code DONE (2026-07-02)** except Tier 2, which is 🔒 client-gated (see below).
- 🔒 OTA contact info, Tier 2 (auto-enrich from Booking.com's new-booking notification
  emails) — **blocked on a real sample**: forward one actual Booking.com "new booking"
  notification email (full original, with headers if possible) so the parser is built
  against reality instead of guesswork. Then: Brevo inbound webhook → parse → match the
  BLOCKED row by unit+dates → auto-attach the contact; Tier 1 stays as the fallback.
- ✅ Booking-source badges — cockpit guest cards now carry `source`; the Today rail flags
  Booking.com/Website arrivals with a violet badge (different arrival workflow).
  (The reservations list already showed source — that half predated H6.)
- ✅ Guest confirmation email on /stay bookings (dark until Brevo is configured;
  fire-and-forget — the booking stands even if the email fails) with a
  **manage-my-booking link**: public `/stay/manage` page + `GET /public/bookings/lookup`
  (code + email must BOTH match; rate-limited; WEBSITE bookings only). `PUBLIC_WEB_URL`
  env (render.yaml carries it) builds the absolute link.
- ✅ Occupancy nudges — `reports.nudges.ts` (pure rules over forward 7/30-day demand:
  ≥85%/80% booked → "firm up rates"; ≤35%/30% → "plan a campaign"), served at
  `GET /reports/nudges`, shown as a strip on the Reports page. The pre-AI Strategy
  Engine — and the grounding data for the AI version (A5) later.
- ✅ DEPLOY.md refreshed with every H1–H6 env var + the cron/backup/monitoring notes
  (the full rewrite happened back in Phase 0 — the stale backlog line said otherwise).
- ⏸️ Still parked (owner-run, live data): demo-data wipe + deactivate the empty "Main"
  building — needs a deliberate DB target + owner eyeball before firing (see memory note).
