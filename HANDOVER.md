# LSP Web App — Handover / Continue-Here Guide

This file is the single source of truth for picking the project up on a new machine
(or in a fresh Claude session). The code lives on GitHub; the working context does not —
so everything you need to continue is captured here.

**Last updated: 2026-07-09.** Companion docs: `ROADMAP.md` (full backlog + status),
`GO-LIVE-FAHAD.md` (plain-English owner go-live checklist), `DEPLOY.md` (deploy/env reference).

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

## 4. Where the project stands (all builds done + merged to `main`)

As of **2026-07-09, development is complete.** Every product phase (0–5) and the hardening track
(H1–H6) is built, tested, and merged to `main` (live on Vercel + Render). What remains is **not
coding** — it's client/owner setup (keys, paid hosting) and a few chores (see §5). The full backlog
with per-item status is in **`ROADMAP.md`**; the owner-facing switch-on checklist is in **`GO-LIVE-FAHAD.md`**.

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
the admin password. The **budget is approved.** Schema is at **migration 060**.

---

## 5. What's left before launch (no more building — a switch-on + launch checklist)

Development is done; what remains is client/owner setup and chores. The plain-English, owner-facing
version of all this is **`GO-LIVE-FAHAD.md`** (parts A–D). Summary:

**Client/owner setup — flips "dark" features on (env vars on the dashboards, not code):**
- `ANTHROPIC_API_KEY` on Render → AI marketing + strategy brief. Slot is documented in `render.yaml`.
  Feature verified green (26 Part-B tests pass). Segments work without it; only generation is gated.
- `BREVO_API_KEY` + `EMAIL_FROM` on Render → guest emails (booking confirmations, manage-my-booking,
  post-stay follow-up).
- Cloudflare R2 bucket + `STORAGE_*` on Render + flip `STORAGE_DRIVER=s3`; GitHub `BACKUP_*` secrets →
  real file storage + nightly DB backups.
- Sentry `SENTRY_DSN` (Render) + `VITE_SENTRY_DSN` (Vercel); UptimeRobot pointed at `/health`.

**The one deadline — Render → paid plan.** Free Postgres expires **~Sep 2026**; the free web service
sleeps when idle. Also a hard prerequisite for Booking.com go-live (its fetcher times out on a sleeping
service).

**Booking.com channel sync (H4) — code complete, owner go-live steps** (see `GO-LIVE-FAHAD.md` Part C
and `ROADMAP.md` H4): per unit, in the unit drawer's "Channel sync" box, paste our export URL into the
Booking.com extranet and paste their `.ics` back; set `CHANNEL_ALERT_EMAIL` + `CRON_SECRET`; add the
15-minute cron trigger (`GET /api/v1/cron/channel-sync` with `Authorization: Bearer <CRON_SECRET>`).
The route is mounted and refuses everyone without the secret — the schedule is the on-switch.

**Parked client decisions:**
- **DPO Pay (Phase B)** — **parked by owner on 2026-07-02** (registration deliberately stopped).
  `settlePaid()` (`apps/api/src/modules/payments/payments.repository.ts`) is the sole writer of a
  reservation to CONFIRMED. Resuming means: generalise it to confirm hold-less `/stay` bookings, wire
  the approved discount into the real gateway charge, and reuse the cron secret-guarded-endpoint pattern
  for the DPO callback.
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
- A new DB change = a new forward-only migration in `apps/api/src/db/migrations/NNN_*.sql` (currently up to 060).
- Property-scoped routes go through `requireActiveProperty` (`core/scope/activeProperty.ts`); scoped queries filter by `req.activePropertyId`.
- Commercial invariant: only `settlePaid()` confirms a reservation; create/edit can never set CONFIRMED.

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
Then read `HANDOVER.md` → `ROADMAP.md` → `GO-LIVE-FAHAD.md`, and recreate the local `.env` + JWT keys (§3).
