# LSP Web App — Handover / Continue-Here Guide

This file is the single source of truth for picking the project up on a new machine
(or in a fresh Claude session). The code lives on GitHub; the working context does not —
so everything you need to continue is captured here.

**Last updated: 2026-09-08.** Companion docs, in the order to read them:
- **`CLAUDE.md`** — the seven invariants. Breaking one is a production bug. Read before writing code.
- **`docs/GAP-REGISTER.md`** — what is *not* built, measured against the client's process map, plus
  the defect log. This is the file that answers "what next"; `ROADMAP.md` no longer does.
- `ROADMAP.md` — the phase-0–5 backlog. ⚠️ Historical: it describes the build up to 2026-07-09 and
  everything in it is done. It does not cover the G-items.
- `GO-LIVE-FAHAD.md` (plain-English owner go-live checklist), `DEPLOY.md` (deploy/env reference).

---

## 1. What this is

**LSP (Lifestyle Operations Platform)** — an operations platform for **Lifestyle Apartments**,
a serviced-apartment operator in **Gaborone, Botswana** (currency: Pula / BWP).

It is a **Turborepo monorepo** with two apps:
- **`apps/api`** — Node.js + Express 5 + TypeScript + Kysely + PostgreSQL + JWT (RS256) + Zod
- **`apps/web`** — React 19 + Vite + Tailwind 4 + shadcn-style UI + React Router v7 + TanStack Query + Zustand
- **`packages/shared-types`** — types shared by both

It covers: auth/RBAC, CRM (guests + leads), reservations, the operations **Cockpit**, housekeeping,
maintenance, pricing, the commercial money-loop (quote → hold → payment → confirm), expenses, an
activity feed, multi-property (Property → Building → Unit), a **public guest booking page** (`/stay`),
**AI marketing + strategy**, and **direct Booking.com channel sync** over iCal (replacing Little Hotelier — see §5).

---

## 2. Live + repo

- **Repo:** https://github.com/TM-fez/lsp-web-app — `main` is the release branch (every feature merges via PR).
- **Live web:** https://lsp-web-app-web.vercel.app (Vercel)
- **Live API:** https://lsp-api-p3zx.onrender.com (Render web service) + **Render Postgres**
- **Architecture:** Web on Vercel proxies `/api/*` + `/health` to the Render API (so the browser stays
  same-origin → first-party refresh cookie). See `DEPLOY.md` (rewritten for the Vercel-web + Render-API
  split; current).
- **Admin login:** `admin@lsp.local` (password was changed by the owner on the live site — not stored anywhere).

---

## 3. Run it on a new machine

Prereqs: **Node 20+**, **npm**, and **Docker** (for local Postgres) or any local Postgres.

```bash
# 1. clone + install
git clone https://github.com/TM-fez/lsp-web-app.git
cd lsp-web-app
npm install

# 2. start Postgres (docker) — or point DATABASE_URL at your own
docker compose -f infra/docker-compose.yml up -d

# 3. API env: copy the example and adjust DATABASE_URL to match your Postgres
cp apps/api/.env.example apps/api/.env
#   default in the example: postgresql://lsp:lsp@localhost:5432/lsp_dev

# 4. generate the JWT signing keys (gitignored; required)
mkdir -p apps/api/keys
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out apps/api/keys/private.pem
openssl rsa -in apps/api/keys/private.pem -pubout -out apps/api/keys/public.pem

# 5. create the schema + seed the admin user
npm run db:migrate
npm run db:seed          # creates admin@lsp.local / Admin@123!  (change on first login)

# 6. run both apps
npm run dev              # API on :3000, web on :5173
```

Open http://localhost:5173 and log in with `admin@lsp.local` / `Admin@123!`.

**What is NOT in the repo (per-machine, gitignored — recreate locally):**
- `apps/api/.env` (copy from `.env.example`) and `apps/web/.env` if used.
- `apps/api/keys/` — the RS256 JWT keypair (step 4 above).
- Any real secrets (`ANTHROPIC_API_KEY`, `BREVO_API_KEY`, `STORAGE_*`, Sentry DSNs). These live on
  Render/Vercel dashboards for production, and only in a local `.env` if you want to exercise them here.

**Important gotchas**
- The API entry point is **`apps/api/src/server.ts`** (started by `npm run dev`), **not** `app.ts`
  (`app.ts` is import-only so it can also run serverless — it does **not** call `listen()`).
- Useful root scripts: `npm run dev | build | lint | test | typecheck | db:migrate | db:seed`.
- The public booking page is at **`/stay`** (no login).

---

## 4. Where the project stands

⚠️ **This section said "development is complete" from 2026-07-09 until this audit. It was wrong by
August.** What was complete on that date was the *phase 0–5 roadmap*. Then the client's actual
operations process map was audited against the app (`docs/GAP-REGISTER.md`, 2026-08-20) and found
**56 process steps, 32 of them not fully covered**. Building resumed and has not stopped: PRs #86–#111,
migrations 061–069, and nine defects found in code that was believed finished.

**The correction worth carrying forward:** "every planned phase is built" and "the business can run on
this" are different claims, and the first was mistaken for the second for about six weeks. The gap
register exists because of that mistake — it measures the app against the client's process, not
against our own backlog. Trust it over `ROADMAP.md`.

**Where it actually stands (2026-09-08):** the phase 0–5 roadmap is done and live. On top of it, the
revenue book is now closed — booking folio, pay-later confirmation, per-night accrual revenue
recognition, and gapless invoice numbering all shipped between 2026-08-31 and 2026-09-08. What remains
is the eight cheap unblocked items at the top of the gap register, two defects needing an owner
decision (D04, D07), and the large blocked or undecided items (a payment gateway, campaigns, long-term
leases, banking). The full backlog with per-item status is in **`docs/GAP-REGISTER.md`**; the
owner-facing switch-on checklist is in **`GO-LIVE-FAHAD.md`**.

Shipped and live:
- Auth/RBAC, Users & Roles, CRM (Guests + Leads), Reservations, the operations Cockpit, Pricing, the
  commercial money-loop, Expenses, the activity feed, per-booking discounts.
- **Multi-property keystone (A1) — done:** `user_properties` (migration 048); a single server-side
  enforcement point (`core/scope/activeProperty.ts` — validates the `X-Property-Id` header against
  membership, admin = wildcard); post-login property picker (`PropertyGate` / `PropertySwitcher`);
  per-building unit naming (migration 051).
- **Operations depth (Phase 3):** maintenance notifications + interval reminders + scoped contractor
  login + landlord-vs-LP ownership mapping; housekeeping three-stage sign-off + compliance checklists
  + turnaround tracking + tablet board.
- **Revenue & intelligence (Phase 4):** Financial Cockpit, Operational Cockpit, and **AI target
  marketing + AI strategy brief** (both dark until `ANTHROPIC_API_KEY` is set).
- **OTA-to-direct (Phase 5):** in-apartment QR self-check-in → CRM capture; automated post-stay
  follow-up email; public enquiry → auto-lead; lead → reservation conversion; lease-renewal reminders.
- **Hardening (H1–H6):** rate-limit/proxy fixes; S3-compatible storage driver + nightly `pg_dump`
  backup; Sentry + structured logging + security headers; the Booking.com channel-sync go-live package
  (H4); property scoping on the money-loop (H5); booking-source badges, `/stay` confirmation emails,
  and occupancy nudges (H6).

**Live data is real:** 25 real apartments (Village blocks B / D / G / I / J / T). The owner has changed
the admin password. The **budget is approved.** Schema is at **migration 069**.

⚠️ **But the app is not carrying real bookings yet** (confirmed 2026-09-08). It is being tested slowly
and deliberately while the business works out how it fits; Little Hotelier is still the live system.
Production holds **two** test bookings. The apartments, users and property structure are real — the
transaction data is not, and reports over it will read near-empty because there is nothing in them
yet, not because they are broken. See the pace note at the top of `docs/GAP-REGISTER.md` before
treating any zero as a defect.

---

## 5. Switch-on checklist (owner setup + operational chores)

⚠️ This section is **not** "what's left" any more — building continues, and the backlog lives in
`docs/GAP-REGISTER.md`. What follows is the narrower thing it is still good for: the setup steps that
need the *owner*, not code. The plain-English, owner-facing version is **`GO-LIVE-FAHAD.md`**
(parts A–D). Summary:

**🔴 Do this before anyone reads a P&L — the G30 revenue backfill.** Migration 069 added the accrual
ledger and `/reports/pnl` now defaults to the accrual basis. **The ledger starts empty**, so on a
freshly-deployed database the P&L reads near-zero revenue until the backfill runs. It is not silent —
the Reports page says how many earning stays are missing — but the sequence matters:

Run it from a **Render shell on the `lsp-api` service** — it lands in the repo root, `DATABASE_URL`
is already in the environment, and `tsx` is present because the service runs on it:

```bash
npm run db:backfill-revenue          # dry run: writes nothing, reports what it would do
npm run db:backfill-revenue:apply    # apply
```

Read the **`Mode:`** line the script prints before believing either one — it says `DRY RUN` or
`APPLY` explicitly. Applying is a separate *script*, not a flag, because `npm run … -- --yes` never
reaches the script (npm has its own `--yes` and eats it); same reason `db:import-guests:apply`
exists. To bound the run by stay date, call the file directly from the root:
`npx tsx apps/api/src/db/backfill-revenue.ts --from 2026-01-01`.

Safe to re-run: `reconcile()` leaves an already-agreeing booking alone.

Check the reconstruction share on the dry run first. Stays with no agreed total are priced at
*today's* rates, because rate plans have no effective dating — those figures are a reconstruction, not
a recovery, and the page says so. **Unverified as of this audit: whether this has been run against
production.** Check before trusting a live revenue figure.

**🟠 Tell the owner about D08 before they notice it.** The same release moved month bucketing from UTC
to `Africa/Gaborone`. Payments taken between 22:00 and midnight Gaborone now fall in the correct
month, which means **some historical cash figures restate**. The shift is small and lands on month
boundaries (it was zero on demo data), but a restated month discovered rather than announced costs
more trust than it saves effort.

**Client/owner setup — flips "dark" features on (env vars on the dashboards, not code):**
- `ANTHROPIC_API_KEY` on Render → AI marketing + strategy brief. Slot is documented in `render.yaml`.
  Feature verified green (26 Part-B tests pass). Segments work without it; only generation is gated.
- `BREVO_API_KEY` + `EMAIL_FROM` on Render → guest emails (booking confirmations, manage-my-booking,
  post-stay follow-up).
- Cloudflare R2 bucket + `STORAGE_*` on Render + flip `STORAGE_DRIVER=s3`; GitHub `BACKUP_*` secrets →
  real file storage + nightly DB backups.
- Sentry `SENTRY_DSN` (Render) + `VITE_SENTRY_DSN` (Vercel); UptimeRobot pointed at `/health`.

**~~The one deadline — Render → paid plan.~~ ✅ Done 2026-09-20.** Web service + Postgres are on
paid plans (`starter` + `basic-256mb` in `render.yaml`); live API `/health` ~0.5s with no cold start.
The free-Postgres expiry that was looming for ~Sep 2026 is historical only, and the sleeping-service
blocker on Booking.com go-live is cleared.

**Booking.com channel sync (H4) — code complete, owner go-live steps** (see `GO-LIVE-FAHAD.md` Part C
and `ROADMAP.md` H4): per unit, in the unit drawer's "Channel sync" box, paste our export URL into the
Booking.com extranet and paste their `.ics` back; set `CHANNEL_ALERT_EMAIL` + `CRON_SECRET`; add the
15-minute cron trigger (`GET /api/v1/cron/channel-sync` with `Authorization: Bearer <CRON_SECRET>`).
The route is mounted and refuses everyone without the secret — the schedule is the on-switch.

**Parked client decisions:**
- **DPO Pay (Phase B)** — **parked by owner on 2026-07-02** (registration deliberately stopped);
  tracked as **G27**, blocked on the client registering the business, opening a bank account and
  passing KYC. `settlePaid()` (`apps/api/src/modules/payments/payments.repository.ts`) is **no longer
  the sole writer of CONFIRMED** — see the invariant note in §6. Resuming means: generalise it to
  confirm hold-less `/stay` bookings, and reuse the cron secret-guarded-endpoint pattern for the DPO
  callback. (~~Wire the approved discount into the real gateway charge~~ — ✅ done in PR #94; the
  charge already defaults to the booking's own priced total, discount applied.)
- **OTA guest details** — Fahad decides: manual extranet copy vs full Booking.com Reservations API. The
  H6 Tier-2 auto-enrich (parse the "new booking" notification email) is blocked until a real sample email
  is forwarded.

**Chores:** wipe leftover demo contacts / reservations / leads before the pilot (**parked** — needs a
deliberate DB target + owner eyeball before firing); deactivate the now-empty "Main" building; clean up
the abandoned Vercel "-api" projects.

**Separate project (not started):** Fez Education skills/e-learning platform — its own accounts and repo.

---

## 6. Conventions (follow these when adding code)

- Thin controllers → service → repository. All mutations write to `audit_logs`.
- Permissions are **dotted** (e.g. `reservations.read`, `properties.create`). Routes gate with `authorize('perm')`.
  Public routes (`modules/public`, health) skip `authenticate`.
- Money is stored in **thebe** (integer minor units; 100 = 1 Pula). Enter in Pula in the UI, store thebe.
- New web feature = `features/<x>/` with TanStack Query hooks + a Radix dialog drawer; gate UI with `useAuthStore.hasPerm`.
- "Today" is **Africa/Gaborone** — use `core/time.ts` (API) and `lib/utils/date.ts` (web), never raw `new Date()` for the property day.
- A new DB change = a new forward-only migration in `apps/api/src/db/migrations/NNN_*.sql` (currently up to 069).
- Property-scoped routes go through `requireActiveProperty` (`core/scope/activeProperty.ts`); scoped queries filter by `req.activePropertyId`.
- ⚠️ **Commercial invariant — REVERSED on 2026-09-07, and this line used to say the opposite.**
  It read "only `settlePaid()` confirms a reservation; create/edit can never set CONFIRMED". That is
  no longer true and has not been since PR #108: **CONFIRMED means the stay is on, not that the money
  arrived.** A guest can be confirmed, and can check in, without paying — some clients settle after
  the stay. `POST /reservations/:id/confirm` (`reservations.routes.ts:82`) sets CONFIRMED outside
  `settlePaid()`, recording who confirmed without payment and why. Money lives on its own axis now:
  the **folio** (total / paid / outstanding, derived from invoices). See invariant 3 in `CLAUDE.md`,
  which is authoritative — when this file and `CLAUDE.md` disagree, `CLAUDE.md` wins.

---

## 7. Note on continuity (read this on the other PC)

**The repo is portable; the working context is not.** Everything the code needs is on GitHub `main` —
so on the other machine, `git clone` (or `git checkout main && git pull`) gets you fully current,
including this file, `ROADMAP.md`, and `GO-LIVE-FAHAD.md`.

Two things do **not** travel with the repo:
- **Claude Code memory files** — they live under `~/.claude/projects/<project-slug>/memory/` on whichever
  machine wrote them, not in git. A fresh Claude session on the other PC won't have them. This `HANDOVER.md`
  is the portable replacement: on the new machine, point Claude at this file first. (Optional: copy the
  memory folder across manually if you have both machines.)
- **Local secrets** — `apps/api/.env`, `apps/api/keys/`, and any API keys. Recreate them per §3.

To get the other PC current right now:
```bash
git clone https://github.com/TM-fez/lsp-web-app.git   # first time
# or, if it already has the repo:
git checkout main && git pull
```
Then read `HANDOVER.md` → `CLAUDE.md` → `docs/GAP-REGISTER.md`, and recreate the local `.env` + JWT
keys (§3). (`ROADMAP.md` is historical — read it for how the app got here, not for what to do next.)

---

## 8. Keeping this file honest

This file claimed "development is complete" for two months while nine migrations and eleven PRs
landed, and §6 stated a commercial invariant that had been deliberately reversed. A stale handover is
worse than no handover: it is confidently wrong, and it is the first thing a new session trusts.

Three rules, each one earned by a specific failure found in the 2026-09-08 audit:

1. **Close the register entry in the same PR as the fix.** D06 was fixed on 2026-09-07 and still read
   `OPEN` the next day. The fix and the record are one change, not two.
2. **When a decision reverses an invariant, grep for the old wording.** Invariant 3 was amended in
   `CLAUDE.md` on 2026-09-07 and the contradicting sentence survived here and in §5's DPO paragraph.
   `CLAUDE.md` is authoritative; everywhere else is a copy that can rot.
3. **Re-audit before starting a feature, not after finishing one.** The register's value is that it
   is measured against the *client's process map*, not our backlog — and that only holds if the
   measurement is recent. Refresh the header's commit, migration count and PR number when you do.

Both docs carry their audit date in the header. If it is more than a few weeks old and the log shows
merged PRs since, re-audit before trusting either one.
