# Checks — what to hunt for, area by area

Each line is a ledger row. "Covered" means you can name the code that makes it
safe. Prefer the LSP-specific checks first; the generic ones catch the rest.

## A. Public pages (`/public`, anonymous)

- A1 Lookup / check-in by reference: can a guess or enumeration reveal another
  guest's name, email, phone, dates, unit or money? Reference entropy, what the
  lookup requires, what the response contains, error wording differences
  ("not found" vs "wrong phone") that confirm a booking exists.
- A2 Email ownership (R6): no response, status code, timing branch or wording
  reveals that an email/phone belongs to an existing guest.
- A3 Booking creation: price, status, discount, `room_id`, property, contact id
  and any money field come from the server, never the body. Zod strips unknown
  keys? Status can only be PENDING (invariant 3).
- A4 Check-in submission: can it attach to someone else's reservation, overwrite
  a guest record, or upload/attach a file?
- A5 Enquiries: property must be active and public; free text length-limited;
  what ends up in staff screens, emails and LLM prompts.
- A6 Rate limits: are `bookingLimiter`/`lookupLimiter` keyed on an IP that is
  real given `trust proxy` and the Vercel → Render hop? Can `X-Forwarded-For`
  be spoofed to reset them?
- A7 Contact creation races (23505 retry) can't be steered into merging an
  attacker into a real guest.

## B. Authentication and sessions

- B1 JWT: algorithm pinned to RS256 (no `none`/HS256 confusion), `exp` checked,
  issuer/audience if used, `sub` used for identity.
- B2 `sid` check (H7) runs on **every** authenticated route, including the
  older-style auth/dashboard modules.
- B3 Refresh token: httpOnly, `Secure`, `SameSite`, path; rotation; reuse
  detection; stored hashed; revoked on logout/logout-all/password change/
  deactivation.
- B4 Login: brute-force limits per account and per IP; constant response for
  unknown user vs wrong password; password hashing algorithm and cost.
- B5 CSRF: cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) —
  what stops a cross-site POST? CORS origin list and `credentials`.
- B6 Password change requires current password; reset flow (if any) tokens.

## C. Authorization and property scope (the big one)

- C1 Every authenticated route has `authorize(...)` with the right permission —
  list any without. Compare permission to the action (read perm on a write?).
- C2 For each route taking `:id`, the repository `WHERE` includes property scope
  for limited users (`propertyScope`, `inProperty`, `reservationRefInProperty`)
  and returns 404 for out-of-scope rows — not 403, not the row.
- C3 `x-property-id`: a limited user setting it to a property they don't belong
  to is refused (`requireActiveProperty`).
- C4 IDs in the **body** (room_id, contact_id, reservation_id, property_id,
  invoice_id, home_property_id) are scope-checked too, not just URL ids.
- C5 Lists, exports, reports, search, marketing segments, the activity feed and
  the calendar apply scope **in the query, before LIMIT**.
- C6 Contractor and housekeeping logins can't reach staff data through shared
  endpoints.
- C7 Rate plans and other estate-wide writes require `requireAllProperties`.
- C8 Mass assignment: Update schemas (`.partial()`) can't set `status`,
  `deleted_at`, `created_by`, `property_id`, `confirmed_without_payment`,
  role/permissions on users, `email_shared`, folio totals.
- C9 Users module: can a non-admin create/elevate a user, change their own role,
  or assign properties they don't hold?

## D. Money integrity (abuse, not just bugs)

- D1 Every money writer takes the reservation row lock and writes the audit row
  in the same transaction (Round 4); find any that doesn't.
- D2 Negative, zero, huge (> `MAX_MONEY_THEBE`) and non-integer amounts refused
  server-side on payments, refunds, discounts, expenses, payroll, rate plans.
- D3 Refund caps (left on invoice, folio credit), credit notes not refundable,
  `confirm_full_refund` question can't be skipped by a crafted body.
- D4 Idempotency: key scoped per user? Can user A replay user B's stored answer
  with B's key? Stored body leaks data?
- D5 Discounts only on PENDING; approval permission enforced server-side.

## E. Injection and output handling

- E1 SQL: grep `sql.raw`, `sql.lit`, `sql.ref`, `sql.id`, `sql.join`, template
  strings inside `sql\`\`` built from input; `orderBy`/sort params from query.
- E2 CSV exports: cells starting `= + - @` (formula injection) from guest-typed
  names/notes.
- E3 Emails: guest text in HTML templates escaped; header injection in
  subject/to/reply-to.
- E4 iCal output: guest text in `SUMMARY`/`DESCRIPTION` (should be none), CRLF
  injection into the feed.
- E5 Web: any `dangerouslySetInnerHTML`, `href={userValue}` (`javascript:`),
  `window.open` with user URLs, markdown rendering.
- E6 LLM (marketing): guest/staff text in the prompt — can it make the model
  output something staff would send or act on? Is output rendered as HTML?
  Is the provider key server-only?
- E7 Logs and Sentry: passwords, tokens, cookies, full bodies or guest PII logged.

## F. Files

- F1 Upload: size limit, allowed types checked on content not just extension,
  stored name server-generated (no path traversal), storage location not
  web-served.
- F2 Download: scope check (C2) on the file's owning record; `Content-Type` and
  `Content-Disposition: attachment` so an uploaded HTML/SVG can't run as the app;
  `X-Content-Type-Options: nosniff` on the API too.
- F3 Library and NULL-property (company-level) files hidden from limited users
  unless they created them.

## G. Tokens, secrets and configuration

- G1 iCal token: length/randomness, rotation exists, feed reveals only busy dates,
  token not logged or shown to roles that shouldn't see it.
- G2 `CRON_SECRET`: refused when unset (it is — re-check), comparison constant-time,
  sent in a header not a query string (query strings land in logs).
- G3 `env.ts`: no insecure default for any secret in production; app refuses to
  boot without required ones.
- G4 Error handler: no stack traces, SQL, or internal ids for anonymous callers.
- G5 Helmet/CORS/global limit in `app.ts`; CSP in `vercel.json` (note
  `style-src 'unsafe-inline'`); HSTS.
- G6 Seed data: default admin password or demo users that would exist in prod.
- G7 `render.yaml` / `DEPLOY.md`: secrets not committed; `git grep` for keys,
  private keys, `.env` files in history (`git log -p -S`).

## H. Availability (reason from code only — never load-test)

- H1 Unbounded inputs: `days` on calendar, page sizes (`parsePageQuery`), array
  lengths in bodies, regexes on user text (ReDoS).
- H2 Expensive anonymous endpoints (availability search, `/stay`) without limits.
- H3 Pool exhaustion paths (R7 N7-1 class): any code holding a connection while
  asking the pool for another.

## I. Dependencies and CI

- I1 `npm audit --omit=dev` from the lockfile (offline if possible); only report
  advisories reachable from LSP code paths.
- I2 GitHub Actions: `pull_request_target`, secrets exposed to forks, unpinned
  third-party actions.

## J. Audit trail and soft delete as security controls

- J1 Every mutation writes `audit_logs` in the same transaction — a missing row
  is a repudiation finding.
- J2 Every read filters `deleted_at` — a deleted guest/booking/file still
  readable is a data-exposure finding.
