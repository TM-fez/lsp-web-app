# LSP attack surface — starting map

Snapshot written 2026-10-11. **Phase 1 must re-check this against the code**;
where they disagree, the code wins and this file should be updated in the same PR
as any fix.

## Principals (who could be the attacker)

| Principal | How they get in | What they should be limited to |
|---|---|---|
| Anonymous internet | `/stay`, `/enquire`, QR check-in, `/api/v1/public/*`, `/api/v1/ical/*`, `/health`, `/api/v1/auth/login` | Their own booking, looked up by what they typed; nothing about other guests |
| Booking.com / any iCal fetcher | `GET /api/v1/ical/units/:token` | One unit's busy dates, no guest details |
| Scheduler caller | `/api/v1/cron/*` with `CRON_SECRET` | Triggering sweeps; refused when the secret is unset |
| Contractor (scoped login) | JWT | Their own jobs only |
| Housekeeping (tablet) | JWT | Room status board |
| Staff limited to some properties | JWT + `x-property-id` | Only rows in `user_properties`; others' rows are a **404** |
| Operations / accounts | JWT | Per role permissions; payroll admin+accounts only; operations has no money ledgers (migration 083) |
| Admin | JWT | Everything |

Trust boundaries worth most attention: anonymous → any guest's data; limited
staff → another property; lower role → a permission it lacks; any user → money
moved without the folio lock or audit row; deactivated/demoted user → still acting.

## Entry points (API, `apps/api/src/router.ts`, mounted under `/api/v1`)

**No `authenticate`:**
- `/public` — `GET /stay`, `POST /bookings` (bookingLimiter), `GET /bookings/lookup`
  (lookupLimiter), `GET|POST /checkin`, `GET /enquiries/properties`,
  `POST /enquiries`. Contact matching: `digitsOf`, email + phone rules (R6, small
  improvements). Revenue recognition runs after writes here too.
- `/ical/units/:token` — per-unit `rooms.ical_token`.
- `/cron/sweep`, `/cron/reminders`, `/cron/channel-sync` — `CRON_SECRET`.
- `/auth/login` (loginLimiters), `/auth/refresh` (refreshLimiter, httpOnly cookie),
  `/auth/logout`.
- `/health`.

**Authenticated (factory routers):** contacts, leads, reservations (incl.
`/calendar`, `/:id/move-preview`, `/:id/mark-paid`), rooms, properties, checkins,
availability, files (upload/download/library), settings, maintenance, pricing,
quotes, holds, payments, invoices (refund), expenses, operating-expenses, payroll,
reports, finance, marketing (uses `core/llm/llm.service.ts`), activity,
notifications, housekeeping, cockpit, users. Older-style: auth `/me`,
`/logout-all`, `/change-password`; dashboard.

## Cross-cutting code to read

- `apps/api/src/app.ts` — helmet, CORS, global rate limit, `trust proxy`
  (`TRUST_PROXY_HOPS` — per-IP limits are only as good as this), `express.json`
  1 MB, 404/error handler.
- `core/auth/authenticate.middleware.ts` — RS256, `sub`, `sid` session check (H7).
- `core/auth/authorize.middleware.ts` — dotted permissions.
- `core/scope/propertyScope.ts`, `core/scope/contactScope.ts` — property/guest scope.
- `core/middleware/idempotency.middleware.ts`, `validate.middleware.ts`.
- `core/errors/*` — what an error response exposes.
- `config/env.ts` — secrets, defaults, `TZ`.
- `modules/files/files.storage.ts`, `files.library.ts` — upload storage, names,
  content type, download headers.
- `core/email/*` — templates with guest-supplied text.
- `core/llm/llm.service.ts` + `modules/marketing` — guest/staff text in prompts.
- `db/migrations/*.sql` — constraints and triggers that enforce invariants.

## Web (`apps/web`)

- `vercel.json` — `/api/*` rewrite to Render (same-origin cookie), CSP
  `script-src 'self'`, `style-src 'unsafe-inline'`, `frame-ancestors 'none'`.
- Public pages under `/stay`, `/enquire`, check-in — render guest-supplied text.
- `RouteGuard` + `components/layout/nav.ts` `permForPath` — **UI only**; the API
  must enforce every permission itself.
- Token storage: where the access token lives in the SPA.

## Already fixed (don't re-report as new; flag a regression if it's back)

H1–H7 in `ROADMAP.md`; H6 scope and data leaks (PR #121); H7 session
revocation (PR #126); R4–R12 items in `CLAUDE.md` and `WORKLOG.md`;
`docs/GAP-REGISTER.md`.
