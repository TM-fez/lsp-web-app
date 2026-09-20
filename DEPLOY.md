# Deploying LSP — Web on Vercel + API & Postgres on Render

This is the live setup. The app runs as **two deployed pieces**:

- **Web (the screens)** → **Vercel**. Builds the React app and serves it. It also
  **proxies `/api/*` and `/health` to the API on Render**, so the browser only ever
  talks to its own domain. That keeps the login/refresh cookie **first-party** (no CORS
  headaches in the browser).
- **API (the engine) + database** → **Render**. An **always-on** Express service plus a
  **Render Postgres** database. Migrations and the first-admin seed run automatically
  every time it starts (both are idempotent — they skip what's already done).

```
Browser ──→ Vercel (web)  ──/api/*──→  Render (API)  ──→  Render Postgres
            same-origin proxy          always-on Express      (paid — starter + basic-256mb)
```

**Live URLs**
- Web: https://lsp-web-app-web.vercel.app
- API: https://lsp-api-p3zx.onrender.com  (health: `/health`)

> **Why two hosts?** Vercel is great for the static front-end; Render gives us a real
> always-on Node server (no cold-start logic, runs the background sweep in-process). The
> Vercel→Render proxy is what makes them feel like one site to the browser.

---

## What's already wired in this repo

- **`apps/web/vercel.json`** — builds the web app (`vite build` → `dist`), rewrites
  `/api/:path*` and `/health` to the Render API, and serves the SPA for everything else.
- **`render.yaml`** — a Render **Blueprint** that defines the `lsp-api` web service and the
  `lsp-db` Postgres database. The API runs with `tsx` (same as dev — no fragile build
  step); its start command runs migrations + the admin seed, then boots the server.
- **`apps/api/src/server.ts`** — the always-on entry. On boot it starts the HTTP listener
  **and** `startScheduler()`, the in-process auto-expiry sweep. Because Render keeps the
  service running, **no external cron is needed**.
- **`apps/api/src/app.ts`** — import-only (no `listen()`), so the same app could run
  serverless. API routes mount under **`/api/v1`**; `/health` is unprefixed.
- **`GET /api/v1/cron/sweep`** — a secret-guarded sweep endpoint (`CRON_SECRET`, Bearer
  token). This is only a **fallback for a serverless host**; on Render the in-process
  scheduler already does this, so you can leave `CRON_SECRET` unset.
- **`GET /api/v1/cron/reminders`** — same `CRON_SECRET` guard; raises the in-app reminder
  notifications (checkouts due today, stale high-priority repairs, unassigned repairs).
  Idempotent per day, so it's safe on any cadence. Like the sweep, this is only a
  **fallback for a serverless host**: since Phase 3 the in-process scheduler runs the
  reminder generators once a day on its own, so on Render you can leave `CRON_SECRET`
  unset and reminders still fire.

- **`GET /api/v1/cron/channel-sync`** — same `CRON_SECRET` guard; pulls each unit's
  Booking.com calendar (the 15-minute import poll). Mounted but **inert until go-live**:
  it refuses every caller without the secret, and with no rooms configured it is a no-op.
  At channel-sync go-live, add a 15-min Render Cron Job / GitHub Action pointing here
  (see `HANDOVER.md` §5 for the full owner checklist).

> **Legacy:** the API lives on Render now (`render.yaml`), never Vercel. The old
> `apps/api/vercel.json` stub from an earlier API-on-Vercel attempt has been removed;
> the abandoned Vercel "-api" project can be deleted from the Vercel dashboard.

---

## One-time setup

### 1. API + database — Render (Blueprint)
In the Render dashboard → **New → Blueprint**, point it at this GitHub repo. Render reads
`render.yaml` and provisions:
- **`lsp-api`** — the web service (`plan: starter`, paid — live **2026-09-20**), and
- **`lsp-db`** — Postgres (`plan: basic-256mb`, paid — live **2026-09-20**).

Production has been on these paid plans since 2026-09-20. If a dashboard snapshot still shows the
old free tiers, re-sync the Blueprint from this repo so it matches `render.yaml`.

`DATABASE_URL` is injected into the API automatically from `lsp-db`. Migrations + the admin
seed run on first boot.

### 2. Generate production JWT keys (do NOT reuse the dev keys)
```bash
openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in private.pem -out public.pem
```

### 3. Set the API environment variables (Render → `lsp-api` → Environment)
`render.yaml` marks the secret ones `sync: false`, meaning **you set them by hand**:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` *(already in `render.yaml`)* |
| `DATABASE_URL` | *(auto, from `lsp-db`)* |
| `JWT_PRIVATE_KEY` | contents of `private.pem` |
| `JWT_PUBLIC_KEY` | contents of `public.pem` |
| `JWT_REFRESH_COOKIE_NAME` | `lsp_refresh` *(already in `render.yaml`)* |
| `CORS_ORIGIN` | the Vercel web URL, e.g. `https://lsp-web-app-web.vercel.app` |
| `CRON_SECRET` | needed for `/cron/channel-sync` (15-min, at go-live); `/cron/sweep` + `/cron/reminders` run in-process on Render |
| `TRUST_PROXY_HOPS` | `2` *(already in `render.yaml` — Vercel→Render chain; makes `req.ip` the real client)* |
| `PUBLIC_WEB_URL` | the Vercel web URL *(already in `render.yaml` — used for guest links in emails)* |
| `SENTRY_DSN` | *(optional — error tracking goes live the moment this is set)* |
| `BREVO_API_KEY` / `EMAIL_FROM` | *(email: invoices, booking confirmations, channel alerts)* |
| `CHANNEL_ALERT_EMAIL` | manager inbox for double-booking alerts *(channel-sync go-live)* |
| `STORAGE_DRIVER` + `STORAGE_S3_*` | flip to `s3` once the R2/B2 bucket exists *(see render.yaml comments — uploads on local disk DIE on every deploy)* |
| `WEBSITE_PENDING_TTL_HOURS` | *(optional — default 24; unpaid /stay bookings auto-cancel after this)* |
| `ANTHROPIC_API_KEY` | *(optional — the Claude/LLM client stays dark until this is set)* |
| `ANTHROPIC_MODEL` | *(optional — defaults to `claude-opus-4-8`)* |

> `CORS_ORIGIN` must be the **web** URL, not the API URL. It's the browser origin the API
> trusts.
>
> `ANTHROPIC_API_KEY` powers the shared Claude/LLM client (Phase 2). Leave it unset until
> the AI features (target marketing, strategy engine) go live — the client is dark and any
> call returns a clear "not configured" error rather than failing.

### 4. Web — Vercel
Create a Vercel project from the same repo with **Root Directory = `apps/web`**. It picks up
`apps/web/vercel.json`, builds the SPA, and proxies API calls to Render. The web app needs
**no API URL env var** — it calls `/api/v1` on its own domain and the proxy forwards it.

After the first web deploy, copy the Vercel URL into the API's `CORS_ORIGIN` (step 3) if it
changed.

### 5. First login
The admin seed creates `admin@lsp.local` / `Admin@123!` on first boot.
**Log in and change that password immediately**, then add your team's users.

---

## Day-to-day: how deploys happen
`main` is the release branch — every feature merges via PR. On merge to `main`:
- **Render** auto-deploys the API (re-runs migrations on start — safe, idempotent).
- **Vercel** auto-deploys the web app.

A new database change is a new forward-only migration in
`apps/api/src/db/migrations/NNN_*.sql`; it applies automatically on the next API deploy.

---

## Honest operating notes
- **Render is on paid plans (2026-09-20).** `starter` web + `basic-256mb` Postgres — always on,
  no cold starts (`/health` ~0.5s). *Historical:* free Postgres was due to expire ~September 2026,
  and the free web service slept when idle (slow wake + Booking.com iCal timeouts) — that was the
  reason for upgrading; it is no longer the current state.
- **Payments are simulated.** This is a live internal tool for staff; taking real guest
  money online (DPO Pay) is a later, separate build — see `ROADMAP.md`.
- **Nightly DB backups** exist as a GitHub Action (`.github/workflows/db-backup.yml`) but
  stay **inert until the `BACKUP_*` repo secrets are set** (Render external DB URL + an
  S3-compatible bucket). Set them — the database is the business's memory.
- **Error tracking (Sentry)** and an **uptime monitor** on `/health` (UptimeRobot free) each take
  ~5 minutes to activate; both are documented in `ROADMAP.md` Part 3 (H2/H3 owner steps).
- **Manual sweep, if ever needed:** with `CRON_SECRET` set, you can trigger the housekeeping
  sweep directly:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://lsp-api-p3zx.onrender.com/api/v1/cron/sweep
  ```
  You normally won't — the always-on server runs it automatically, and expiry is enforced
  at point-of-use regardless.
