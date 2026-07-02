# LSP Web App — Handover / Continue-Here Guide

This file is the single source of truth for picking the project up on a new machine
(or in a fresh Claude session). The code lives on GitHub; the working context does not —
so everything you need to continue is captured here.

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
and **direct Booking.com channel sync** over iCal (replacing Little Hotelier — see §5).

---

## 2. Live + repo

- **Repo:** https://github.com/TM-fez/lsp-web-app — `main` is the release branch (every feature merges via PR).
- **Live web:** https://lsp-web-app-web.vercel.app (Vercel)
- **Live API:** https://lsp-api-p3zx.onrender.com (Render web service) + **Render Postgres**
- **Architecture:** Web on Vercel proxies `/api/*` + `/health` to the Render API (so the browser stays
  same-origin → first-party refresh cookie). See `DEPLOY.md` (note: DEPLOY.md is partly outdated — it
  predates the Vercel-web + Render-API split; treat this section as the truth).
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

**Important gotchas**
- The API entry point is **`apps/api/src/server.ts`** (started by `npm run dev`), **not** `app.ts`
  (`app.ts` is import-only so it can also run serverless — it does **not** call `listen()`).
- Useful root scripts: `npm run dev | build | lint | test | typecheck | db:migrate | db:seed`.
- The public booking page is at **`/stay`** (no login).

---

## 4. Where the project stands (done + merged to `main`)

Built and shipped: full RBAC + Users & Roles, CRM (Guests, Leads), Reservations, Cockpit (unit board +
arrivals/in-house/departures + assign drawer), Housekeeping, Maintenance (+ contractor costs/expenses +
accountability), Pricing, the commercial money-loop, an editorial UI overhaul, the **activity feed**,
**per-booking discounts** wired into the amount due, **multi-property** (Property → Building → Unit with a
Properties admin screen + cockpit/reservations property filters), the **public booking page (Phase A —
pay-on-arrival)**, and a dead-code cleanup.

**Live data is real:** the demo units were removed; the live site has **25 real apartments** organised into
**Village blocks B / D / G / I / J / T**. The owner has changed the admin password. The **budget is approved.**

---

## 5. What's next (the roadmap)

### Channel sync — Booking.com, direct iCal (replaces Little Hotelier) — IN PROGRESS
**Decision (supersedes the old plan):** Little Hotelier is dropped. **LSP is the channel manager** and talks
to Booking.com directly over iCal. The one master calendar is LSP's database. (The earlier "keep Little
Hotelier, never connect Booking.com directly" plan is void.)

**Built (code complete; NOT yet run on live):**
- **Hard floor:** migration `035` already makes Postgres physically refuse a double-booking; `046` extends
  it so imported OTA nights participate too.
- **Schema:** `045` adds the `BLOCKED` reservation status (set only by the importer, never by a user); `046`
  adds `rooms.ical_token`, `rooms.booking_ical_url`, `reservations.source` (DIRECT/WEBSITE/BOOKING_COM) +
  `external_uid`, and rebuilds `reservations_no_overlap` to include `BLOCKED`; `047` seeds the system actors
  imported blocks hang off of (reservations' contact/created_by are NOT NULL).
- **Export (LSP → Booking.com):** public, token-guarded feed `GET /api/v1/ical/units/{ical_token}.ics` — live
  per-unit availability, DIRECT/WEBSITE confirmed+checked-in nights only. Never re-exports an imported OTA
  block (no feedback loop) and never leaks guest PII. Paste each unit's URL into the Booking.com extranet.
- **Import (Booking.com → LSP):** `ChannelImportService.runImport()` pulls each unit's `booking_ical_url`,
  upserts OTA bookings as `BLOCKED` (idempotent by `external_uid`), ends blocks that vanish from the feed,
  and on a `23P01` overlap with a direct sale fires a **multi-channel alert** instead of failing silently.
- **Alerts:** dashboard (activity-feed entry, live) + email (Brevo, live once `CHANNEL_ALERT_EMAIL` is set) +
  WhatsApp (seam built, **dark** until a template is approved and `WHATSAPP_LIVE=1`). Repeat pages for the
  same OTA event are throttled to once per 6 hours.
- **Tests:** the export filter (a BOOKING_COM block must never appear in the feed) is proven in the live-DB CI
  suite; the parser, the collision→alert path, the throttle, and the alert fan-out are unit-tested.

**Go-live checklist (owner-run, in order — updated for H4, 2026-07-02):**
1. **Render → paid plan** (Booking.com's calendar fetcher times out on a sleeping free service).
2. **Back up** Render Postgres (or rely on the H4-era nightly backup workflow once its secrets are set).
3. Migrations 045–047 are already applied on live (they run on every deploy) — just verify `/health`.
4. Per unit, in the **unit drawer's "Channel sync" section** (no SQL needed since H4): copy our export
   URL → paste into the Booking.com extranet (Rates & Availability → Sync calendars); copy Booking.com's
   `.ics` link → paste into the drawer's import field (validated: https + booking.com only).
5. Set `CHANNEL_ALERT_EMAIL` + `CRON_SECRET` on Render (and later `WHATSAPP_*` when the template clears).
6. Add the 15-min trigger (Render Cron Job / GitHub Action): GET `/api/v1/cron/channel-sync` with header
   `Authorization: Bearer <CRON_SECRET>`. The route is already mounted and refuses everyone without the
   secret — the schedule is the on-switch. Hardened in H4: advisory lock, empty-feed/mass-cancel guards,
   and the "claim this booking" flow that turns anonymous OTA blocks into check-in-able guests.

**New env vars:** `CHANNEL_ALERT_EMAIL`, `WHATSAPP_TOKEN`, `WHATSAPP_FROM`, `WHATSAPP_TO`, `WHATSAPP_LIVE`.

### Blocked on the client
- **DPO merchant signup** (in progress) → they hand over **sandbox API keys** → unblocks Phase B payments.

### Phase B — DPO online payments (the next big build)
Replace the *simulated* payment outcome with the real **DPO Pay** gateway. DPO is the chosen gateway
(settles locally in BWP via FNB/Stanbic; card + mobile money; best long-term fit). Flutterwave is the backup.

Flow: `create deposit payment → DPO hosted checkout → return + server callback → verify with DPO →
existing settlePaid() flips reservation PENDING → CONFIRMED`.

Key code facts:
- `settlePaid()` in `apps/api/src/modules/payments/payments.repository.ts` is the **sole** writer of a
  reservation to CONFIRMED; it threads via `hold → reservation_id`.
- Public `/stay` bookings create a reservation **directly (no hold)** → Phase B must generalise the payment
  intent / `settlePaid` to confirm a reservation that has no hold (or route web bookings through a hold).
- Reuse the cron secret-guarded-endpoint pattern (`modules/cron/cron.routes.ts`) for the DPO callback.
- Also: wire the approved discount into the **actual** gateway charge (today it only reduces the *displayed* amount due).

### Remaining go-live cleanup
- Wipe leftover demo **contacts / reservations / leads** (from seed-live) before the real pilot.
- Optionally deactivate the now-empty "Main" building under Village.

### Smaller feature gaps (from the client's process map)
- Surface reservation **origin** in cockpit/reservations. The `source` column now exists (migration 046:
  DIRECT / WEBSITE / BOOKING_COM), but `/stay` bookings still write DIRECT and the UI doesn't show it yet.
- Reports / Performance dashboard (occupancy, conversion, revenue, direct vs OTA).
- WhatsApp → Leads auto-capture; lead → reservation conversion; retention/reviews; lease-renewal workflow.

### Tech debt / ops
- `DEPLOY.md` is outdated (rewrite for Vercel-web + Render-API split).
- Render **free Postgres expires ~Sep 2026** → move to paid before real daily use; free web service sleeps when idle.
- Clean up abandoned Vercel "-api" projects.

### Later / strategic
- Channel sync is no longer "later" — it moved up and is the **direct Booking.com iCal** build above
  (Little Hotelier dropped). Future hardening: a real-time API instead of polling, and more OTAs.
- **Fez Education** skills/e-learning platform — a **separate** project (own accounts, own repo), not started.

---

## 6. Conventions (follow these when adding code)

- Thin controllers → service → repository. All mutations write to `audit_logs`.
- Permissions are **dotted** (e.g. `reservations.read`, `properties.create`). Routes gate with `authorize('perm')`.
  Public routes (`modules/public`, health) skip `authenticate`.
- Money is stored in **thebe** (integer minor units; 100 = 1 Pula). Enter in Pula in the UI, store thebe.
- New web feature = `features/<x>/` with TanStack Query hooks + a Radix dialog drawer; gate UI with `useAuthStore.hasPerm`.
- "Today" is **Africa/Gaborone** — use `core/time.ts` (API) and `lib/utils/date.ts` (web), never raw `new Date()` for the property day.
- A new DB change = a new forward-only migration in `apps/api/src/db/migrations/NNN_*.sql` (currently up to 047).
- Commercial invariant: only `settlePaid()` confirms a reservation; create/edit can never set CONFIRMED.

---

## 7. Note on continuity

Past sessions used Claude Code **memory files** that live on the original machine and **do not travel with the
repo**. This `HANDOVER.md` is the portable replacement — it captures the state and plan. On the new machine,
just point Claude at this file. (If you have the old machine, the memory folder is at
`~/.claude/projects/-Users-macbookair-Desktop-lsp-web-app/memory/` — optional to copy over.)
