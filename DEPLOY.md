# Deploying LSP to Vercel (web + API) + Neon (database)

This guide takes the app from "runs on a laptop" to a live, secure web address your
team can log into. It targets **one Vercel project** serving both the screens and the
API on the **same domain** (so the login/refresh cookie stays first-party — no CORS),
with a **free Neon Postgres** for the data and a **daily cron** for housekeeping.

> Hosting cost: **$0 to deploy and pilot.** Vercel's free (Hobby) plan is for
> personal/non-commercial use, so for day-to-day business use you'll move to **Vercel
> Pro (~$20/mo)**. Neon has a free tier that sleeps when idle (first request after idle
> is a little slow) — fine to start.

## What's already wired in this repo

- `vercel.json` — builds the web app, routes `/api/v1/*` and `/health` to the API
  function, serves the SPA for everything else, and schedules the daily sweep cron.
- `api/index.ts` — the serverless entry; exports the Express app (no `listen()`).
- `apps/api/src/app.ts` / `server.ts` — the app is import-only; `server.ts` is the
  always-on local entry. Keys load from **env vars** in production (`JWT_PRIVATE_KEY` /
  `JWT_PUBLIC_KEY`) or files locally.
- `GET /api/v1/cron/sweep` — secret-guarded auto-expiry sweep the cron calls.

## One-time setup

### 1. Database — add Neon (free)
In the Vercel dashboard → **Storage → Create Database → Neon (Postgres)**. Vercel adds a
`DATABASE_URL` env var to the project. **Use the pooled connection string** (Neon labels
it "Pooled connection") — serverless opens many short connections.

### 2. Generate production JWT keys (do NOT reuse the dev keys)
```bash
openssl genpkey -algorithm RSA -out private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in private.pem -out public.pem
```
Paste the file contents into the `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` env vars below.

### 3. Environment variables (Vercel → Settings → Environment Variables)
| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | (set by Neon — use the **pooled** string) |
| `JWT_PRIVATE_KEY` | contents of `private.pem` |
| `JWT_PUBLIC_KEY` | contents of `public.pem` |
| `JWT_REFRESH_COOKIE_NAME` | `lsp_refresh` |
| `CORS_ORIGIN` | your Vercel URL, e.g. `https://lsp.vercel.app` |
| `CRON_SECRET` | a long random string (Vercel sends this to the cron automatically) |
| `BCRYPT_ROUNDS` | `12` |

The web app needs no API URL — it calls `/api/v1` on the same domain by default.

### 4. Run migrations + seed the first admin (one-time, from your laptop)
```bash
DATABASE_URL="<your Neon pooled URL>" npm --prefix apps/api run db:migrate
DATABASE_URL="<your Neon pooled URL>" npm --prefix apps/api run db:seed
```
This creates the tables and the default admin (`admin@lsp.local` / `Admin@123!`).
**Log in and change that password immediately.**

### 5. Deploy
Connect the GitHub repo as a Vercel project (Root Directory = repo root) and deploy.
Open the URL, log in, change the admin password, and add your team's users.

## Honest first-deploy notes
- **The web deploys cleanly.** The **API function** (a TypeScript monorepo Express app)
  is the part that can need a small path/build tweak on the very first deploy — that's
  normal; we adjust `vercel.json` / `api/index.ts` once and redeploy.
- **Cron frequency:** the Hobby plan runs crons **once a day**. That's fine here —
  expired holds/quotes are already refused the moment anyone tries to use them, so the
  sweep is only tidying statuses. On Pro you can run it more often.
- **Payments are simulated** — this is a live internal tool for staff, alongside Little
  Hotelier. Taking real guest money online is a later, separate piece.
