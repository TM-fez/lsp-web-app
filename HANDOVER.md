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
activity feed, multi-property (Property → Building → Unit), and a **public guest booking page** (`/stay`).

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
- `reservations.source = WEBSITE` column (+ surface origin in cockpit/reservations).
- Reports / Performance dashboard (occupancy, conversion, revenue, direct vs OTA).
- WhatsApp → Leads auto-capture; lead → reservation conversion; retention/reviews; lease-renewal workflow.

### Tech debt / ops
- `DEPLOY.md` is outdated (rewrite for Vercel-web + Render-API split).
- Render **free Postgres expires ~Sep 2026** → move to paid before real daily use; free web service sleeps when idle.
- Clean up abandoned Vercel "-api" projects.

### Later / strategic
- Channel sync: keep **Little Hotelier** as the channel manager; sync the app ↔ Little Hotelier (Booking.com
  comes through it — do **not** connect Booking.com directly). Phased: mirror (read-only) → two-way iCal →
  real-time API. One master calendar at all times.
- **Fez Education** skills/e-learning platform — a **separate** project (own accounts, own repo), not started.

---

## 6. Conventions (follow these when adding code)

- Thin controllers → service → repository. All mutations write to `audit_logs`.
- Permissions are **dotted** (e.g. `reservations.read`, `properties.create`). Routes gate with `authorize('perm')`.
  Public routes (`modules/public`, health) skip `authenticate`.
- Money is stored in **thebe** (integer minor units; 100 = 1 Pula). Enter in Pula in the UI, store thebe.
- New web feature = `features/<x>/` with TanStack Query hooks + a Radix dialog drawer; gate UI with `useAuthStore.hasPerm`.
- "Today" is **Africa/Gaborone** — use `core/time.ts` (API) and `lib/utils/date.ts` (web), never raw `new Date()` for the property day.
- A new DB change = a new forward-only migration in `apps/api/src/db/migrations/NNN_*.sql` (currently up to 040).
- Commercial invariant: only `settlePaid()` confirms a reservation; create/edit can never set CONFIRMED.

---

## 7. Note on continuity

Past sessions used Claude Code **memory files** that live on the original machine and **do not travel with the
repo**. This `HANDOVER.md` is the portable replacement — it captures the state and plan. On the new machine,
just point Claude at this file. (If you have the old machine, the memory folder is at
`~/.claude/projects/-Users-macbookair-Desktop-lsp-web-app/memory/` — optional to copy over.)
