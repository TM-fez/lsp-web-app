# LSP — Lifestyle Operations Platform

Bespoke operations platform for **Lifestyle Apartments**, a serviced-apartment operator in
Gaborone, Botswana. 25 live units across Village blocks B/D/G/I/J/T. Users: admin, staff,
housekeeping (tablet board), scoped contractor logins, property managers, plus unauthenticated
guests on the public `/stay` booking + QR check-in flow.

**Read first for context:** `HANDOVER.md` → `ROADMAP.md` → `GO-LIVE-FAHAD.md`.
`PROPOSAL-FAHAD.md` and `GO-LIVE-FAHAD.md` are written *for the client* — keep them plain-English,
no jargon, and preserve the 👤 "Your call" / 🔧 "Technical" markers.

## Stack

npm workspaces + Turborepo. Node 20.

| Workspace | What |
|---|---|
| `apps/api` | Express 5, **pure ESM**, TypeScript strict, Postgres via **Kysely** (not Prisma/Drizzle) |
| `apps/web` | **Vite 6 + React 19 SPA** (not Next.js), react-router-dom v7, TanStack Query v5, Zustand, Tailwind v4 |
| `packages/shared-types` | Thin shared types (~176 lines). Apps import raw `src/`, not `dist/` |

## Commands

```bash
npm run dev            # turbo → api :3000, web :5173
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # unit tests only (live-DB + e2e excluded)
npm run db:migrate     # → @lsp/api
npm run db:seed

# live-DB suites (needs docker)
docker compose -f infra/docker-compose.test.yml up -d
cd apps/api && DATABASE_URL=postgresql://lsp:lsp@localhost:5433/lsp_test npx vitest run --config vitest.live.config.ts
cd apps/api && npx vitest run --config vitest.e2e.config.ts
```

CI gates every PR on: lint + typecheck + unit + live-DB + e2e. There is **no prettier check in CI** —
formatting is convention-only, so match the existing style by hand.

## Non-negotiable domain rules

These are real invariants. Breaking one is a production bug, not a style issue.

1. **Money is integer minor units (thebe). 100 thebe = 1 BWP.** Never store or compute in floats.
   Convert only at the UI edge via `pulaToThebe` / `thebeToPula` / `formatMoney` in
   `apps/web/src/lib/utils/money.ts`. Percentages are basis points (`bpsToPct` / `pctToBps`).
2. **Never use raw `new Date()` for "the property day".** Timezone of record is `Africa/Gaborone`.
   Use `apps/api/src/core/time.ts` and `apps/web/src/lib/utils/date.ts` (`todayISO(offsetDays)`).
3. **Only `settlePaid()` in `apps/api/src/modules/payments/payments.repository.ts` may set a
   reservation to CONFIRMED.** Create/edit paths must never do it.
4. **No double-booking.** Overlap = `daterange(check_in_date, check_out_date, '[)')` on the same
   `room_id` — half-open, so same-day checkout/checkin is legal. Enforced by the DB constraint
   `reservations_no_overlap`; catch Postgres code `23P01` (see `isReservationOverlapError`).
5. **Soft delete everywhere.** Every read filters `.where('deleted_at', 'is', null)`.
6. **Every mutation writes an `audit_logs` row in the same transaction.** `meta = { userId, ip, requestId }`
   is threaded controller → service → repository.

⚠️ **Known open bug:** two divergent definitions of "blocked". `Reservation.checkAvailability` blocks
PENDING+CONFIRMED+CHECKED_IN; the availability engine counts only CONFIRMED. This is the
"looked free, got 409" surface. See `reservation_integrity_gate.sql`. The fix ("PENDING blocks") is a
**human policy decision** — do not resolve it unilaterally.

## API conventions (`apps/api`)

**ESM: every relative import needs a `.js` extension**, even when importing a `.ts` file:
`import { AppError } from '../errors/AppError.js';` (tests are the exception — Vitest resolves them bare).

Module layout is flat per feature: `<module>.routes.ts` / `.controller.ts` / `.service.ts` /
`.repository.ts` / `.types.ts` under `src/modules/<name>/`. Mount prefixes live only in `src/router.ts`.

**Factory router + class DI** — the pattern for all new modules (28 of 31 follow it):

```ts
export function createLeadsRouter(dbInstance = db): Router {
  const router = Router();
  const repository = new LeadsRepository(dbInstance);
  const service = new LeadsService(repository, reservations);
  const controller = new LeadsController(service);
  router.use(authenticate);
  router.get('/', authorize('crm.leads.read'), controller.getLeads);
  router.post('/', authorize('crm.leads.create'), validateBody(CreateLeadSchema), controller.createLead);
  return router;
}
```

The `dbInstance = db` default exists so tests can inject a fake. Middleware order is **always**
`authenticate` → `authorize(...)` → [`requireActiveProperty`] → `validateBody(Schema)` → handler.

`src/modules/auth`, `dashboard`, `health` use an older module-function style — **don't copy them.**

- **Errors:** always `throw AppError.badRequest(...)` / `.notFound(...)` / `.conflict(...)` — never `new Error`.
  Messages are user-facing prose: *"Choose a guest before converting this enquiry to a booking."*
- **Controllers:** class with arrow-function properties (auto-bound), each `try { … } catch (err) { next(err); }`.
  201 on create, 204 on delete.
- **Repositories:** wrap the mutation + its `audit_logs` insert in one `db.transaction().execute()`.
- **Auth:** JWT RS256 access token (15m) + opaque refresh token in an httpOnly cookie. User id is the
  JWT **`sub`** claim, not `id`. Permissions are dotted verbs: `crm.leads.read`,
  `reservations.discount.approve`. Multi-tenancy via the `x-property-id` header → `req.activePropertyId`.
- **Validation:** Zod v3. Schemas live in the module's `.types.ts` as `PascalCaseSchema`, with
  `export type XDTO = z.infer<typeof XSchema>` beside them. `UpdateXSchema = CreateXSchema.partial()`.
- **Migrations:** plain SQL in `src/db/migrations/`, strictly `NNN_snake_case.sql` (at 060). Open with a
  comment block explaining *why*. **Adding one means hand-updating `src/db/types.ts`** — the Kysely
  `Database` interface is hand-written, not generated.
- **Tests:** in a top-level `tests/` tree (`unit/`, `integration/`, `e2e/`) mirroring `src/modules/` —
  not colocated.

## Web conventions (`apps/web`)

Organized by feature: `src/features/<domain>/` holds `XxxPage.tsx`, `XxxFormDrawer.tsx`, `hooks.ts`,
optional `util.ts`, and colocated `*.test.tsx`.

**Three-layer data flow, always. Components never import axios or `lib/api/*` directly.**

1. `lib/api/<domain>.ts` — thin typed axios fn, exported input interface
2. `features/<domain>/hooks.ts` — a module-level key const, a `useInvalidate()` helper, mutations that
   toast on success/error
3. Component calls `useRooms()` / `create.mutateAsync(...)`

```ts
const ROOMS_KEY = ['rooms'] as const;
export function useCreateRoom() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateRoomInput) => createRoom(input),
    onSuccess: () => { toast.success('Unit created'); invalidate(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}
```

- **`export function PascalCase()` only.** Zero default exports, zero `React.FC`, zero arrow-function
  components in the tree. Keep it that way.
- Props: local `interface Props { … }` directly above the component. Private sub-components live in the
  **same file, below** the exported one, unexported.
- Files: PascalCase for components, lowercase for `components/ui/*` and non-component modules
  (`hooks.ts`, `nav.ts`, `csv.ts`).
- Imports: `@/`-absolute across features, relative (`./hooks`) within a feature.
- **Forms are manual `useState` per field** + a `useEffect` reset on `open`, a `const valid = …` gate, and
  `await mutateAsync()` in a try/catch with an empty catch (`/* hook surfaces the error toast */`).
  Only `LoginPage.tsx` uses react-hook-form — don't treat it as the pattern.
- **Styling:** Tailwind v4, CSS-first theme in `src/index.css` (`@theme { … }`) — there is no
  `tailwind.config.js`. Prefer semantic tokens: `bg-cream`, `text-ink`, `bg-forest`, `text-muted`,
  `border-line`, `text-terra`. Note the `slate-*`/`emerald-*`/`rose-*` ramps are deliberately
  overridden with warm values.
- Page headers are always `<h1 className="font-display text-4xl text-ink">` + a `text-sm text-slate-500`
  subtitle.
- **Every list screen uses the same 4-branch render:** `isLoading` → `<Spinner>`; `isError` →
  `<EmptyState>` with a Retry button; empty → `<EmptyState>` with an icon; else the table.
  `EmptyState` copy must say **why it's empty and what to do next**, in full sentences.
- Permission gating is **per-element, not per-route**: `const canCreate = hasPerm('rooms.create')`.
- Icons: lucide-react only. Buttons take an icon child.
- `components/ui/` is hand-written shadcn-*style*, not CLI-generated. `Dialog` is styled as a
  right-side drawer — hence `*FormDrawer.tsx`.

## Style

Prettier: `singleQuote`, `semi: true`, `trailingComma: "es5"`, `printWidth: 100`, 2 spaces.
ESLint: `no-explicit-any` warn, `no-console` warn (`warn`/`error` allowed), unused args need `_` prefix.

DB columns and DTO fields are `snake_case`; TS locals/functions `camelCase`; classes `PascalCase`.

**Comment the *why*, not the what.** This codebase's most distinctive trait is heavy explanatory block
comments carrying phase tags — `(H4)`, `(P5.1)`, `(Phase 3)` — that record *why* a decision was made.
New code is expected to carry the same. User-facing copy uses typographic apostrophes (’) and em-dashes (—).

## Git

`main` is the release branch; **everything merges via PR** (85 so far). Branches are
`feat/…` `fix/…` `chore/…` `docs/…`, encoding the roadmap ID: `feat/p5-lease-renewal`, `fix/h1-hardening`.
Commits are conventional-commits with scopes: `feat(housekeeping): P3.6 — tablet board (live room status)`.
Stacked PRs are normal practice.

## Deployment

Web → **Vercel** (`apps/web`), API + Postgres → **Render** (`render.yaml`). Vercel rewrites `/api/*` to
Render so the browser stays same-origin and the refresh cookie is first-party. API runs via `tsx` with
no build step; migrations + seed are idempotent and run on every boot. `startScheduler()` runs
in-process, so no external cron is needed.

⚠️ **Hard deadline: the free Render Postgres expires ~Sep 2026**, and the free web service sleeps —
which breaks Booking.com's iCal fetcher. See `DEPLOY.md` and `GO-LIVE-FAHAD.md` Part A.
