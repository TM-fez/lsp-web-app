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
npm test               # vitest unit config — NOT DB-free: it also runs tests/integration/*, which need
                       # a migrated Postgres in DATABASE_URL (use the lsp_test DB, never a dev/prod one)
npm run db:migrate     # → @lsp/api
npm run db:seed
npm run db:backfill-invoices          # dry run (default): receipts + open-invoice-vs-folio repair, writes nothing
npm run db:backfill-invoices:apply    # apply. Owner runs this on prod, after deploy + migrate. Flags go after `--`:
                                      #   --reconstruct-prices (price at TODAY's rates where no agreed total exists)
                                      #   --reservation=<uuid> (repeatable) to limit to given bookings

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
3. **CONFIRMED means the stay is on — not that the money arrived.** Owner decision 2026-09-07:
   a guest can be confirmed, and can check in, without paying. Some clients settle after the stay,
   and a booking nobody has paid for is still a booking the house must honour. Money lives on its
   own axis — the *folio* (total / paid / outstanding, derived from invoices).
   Three sanctioned writers may set CONFIRMED, each auditing who did it in the same transaction:
   `settlePaid()` (`modules/payments/payments.repository.ts` — payment arrived),
   `confirmWithoutPayment()` (`modules/reservations/reservations.service.ts` — staff vouched for
   it, `confirmed_without_payment = true`; ⏳ lands in `feat/g28-confirm-without-payment`), and
   `claimOtaBooking()` (same file — a Booking.com block gained a real guest). Create/edit paths must still never set it directly:
   `UserInputReservationStatusEnum` stays `['PENDING']`.
   *This rule previously read "only `settlePaid()`" — which `claimOtaBooking` had already quietly
   outgrown. The decoupling makes the existing exception coherent rather than adding a new one.*
4. **No double-booking.** Overlap = `daterange(check_in_date, check_out_date, '[)')` on the same
   `room_id` — half-open, so same-day checkout/checkin is legal. Enforced by the DB constraint
   `reservations_no_overlap`; catch Postgres code `23P01` (see `isReservationOverlapError`).
5. **Soft delete everywhere.** Every read filters `.where('deleted_at', 'is', null)`.
6. **Every mutation writes an `audit_logs` row in the same transaction.** `meta = { userId, ip, requestId }`
   is threaded controller → service → repository.
7. **An unpaid booking holds the room.** PENDING blocks, everywhere. Owner decision 2026-09-01,
   closing defect D01 ("looked free, got 409" — the availability engine used to count only
   CONFIRMED while `checkAvailability` and the DB constraint both blocked on PENDING). Three
   places must agree and must move together if this is ever reversed:
   `AvailabilityRepository` (3 queries), `ReservationsRepository.checkAvailability`
   (a *blacklist* — new statuses block unless named), and `reservations_no_overlap`
   (migration 046, a whitelist). `availability-d01.test.ts` asserts the invariant rather than
   the rule: what search calls free must be bookable, and vice versa.
   Consequence, deliberate: `EXPORTABLE_STATUSES` includes PENDING, so a held night publishes to
   Booking.com as busy. Over-blocking loses a booking; under-blocking loses a guest's room.
   **The money axis is separate and must stay that way.** No availability, overlap or channel-export
   query may reference the folio, the derived payment state, or the `invoices` table. Whether a
   booking holds the room is a question about its *status*, never about its money — an unpaid
   booking holds the room, and so does a part-paid one. `tests/unit/core/money-axis-invariant.test.ts` asserts this, so
   a future "free up the unpaid ones" optimisation fails loudly.

   **The receivable invariant (Stage 1, migration 070–071).** For every live, non-terminal booking
   there is *at most one* open (ISSUED / PARTIALLY_PAID) DEPOSIT/BALANCE invoice and it equals the
   folio outstanding (`agreed total − Σ PAID receipts`). `PARTIALLY_PAID` means exactly one thing:
   *the open invoice of a booking that has already received money.* Everything that moves money goes
   through `core/money/folio.ts` (lock the reservation row, `FOR NO KEY UPDATE`, **before** reading
   `paidToDate`) and ends in `reconcileReceivable()` (`modules/invoices/invoices.receivable.ts`),
   in the **same transaction** as the audit row. Never size an invoice, a payment or a refund from a
   re-priced total — use the frozen folio total (`reservations.folio_total_amount`). Desk payments
   are `PaymentsService.recordDeskPayment`; settling an invoice is `InvoicesRepository.settle`;
   both refuse to collect more than is owed (`AppError`). A receipt is an invoice born `PAID`.
   `invoices.due_date` = later of (issue day, check-in) + `INVOICE_TERMS_DAYS`; "overdue" is computed
   against the Gaborone day, server-side.

   ✅ **Owner decisions 2026-10-02:** (a) **a refund never puts the guest back in debt** — refunding
   lowers the agreed total by the same amount, so outstanding is unchanged (`InvoicesRepository.refund`);
   (b) **no-shows are not charged** — NO_SHOW, like CANCELLED, voids the open invoice;
   (c) **payment terms are 7 days** (`INVOICE_TERMS_DAYS` default). Do not change any of these without asking.
   ✅ **Owner decision 2026-10-04 — partial refunds:** a part-refunded invoice **stays PAID** (shown with
   "P100 refunded") and can be refunded again up to what is left; it becomes REFUNDED only when all of it
   has gone back. Each credit note points at its original (`refund_of_invoice_id`, migration 075); "left"
   is checked under the original's row lock in `InvoicesRepository.refund`. A credit note is never refundable.
   ✅ **Owner decisions 2026-10-04 (re-test round 2):** (a) **guests are per property** for staff limited
   to some properties — guest list, guest by id, marketing segments and the activity feed all apply
   `core/scope/contactScope.ts` (booked at one of their properties, never booked anywhere, or created by
   them); admins see everyone. (b) **Payroll is admin + accounts only** (migration 077 removed it from
   operations). (c) **A FIXED discount comes off the VAT-inclusive total** — "P200 off" means the guest
   pays exactly P200 less (`buildReservationPricing`); a PERCENT discount still applies to the subtotal.
   (d) **A complimentary (P0) stay gets no invoice** — the folio reads PAID with "Complimentary — no
   charge"; no zero-value document is issued.
   ✅ **Owner decisions 2026-10-04 (round 4):** (a) **Reports count revenue before VAT** — cash
   (`total − tax` per invoice, refunds negative) and earned (`amount − tax_amount`); VAT stays on its own
   line. Owner (landlord) statements are deliberately left gross until the owner says otherwise.
   (b) **Rate plans are estate-wide, so only an admin or a member of every active property may change
   them** (`requireAllProperties` in `core/scope/propertyScope.ts`); limited users may still read them.
   (c) **Operations keeps reports and trends but not the money ledgers** — migration 083 removed
   `invoices.read`, `payments.read`, `opex.read`; the Finance cockpit now follows `invoices.read`.
   (d) **A full refund leaves the booking as it is** — it stays CONFIRMED with the agreed total lowered;
   staff cancel it separately if the stay is off. Never auto-cancel from a refund.
   ✅ **Decisions 2026-10-04 (R5, the open list):** (a) **Landlord statements are before VAT too**
   (`revenueByOwnedRoom` uses `NET_CASH`). (b) **A booking-less hold blocks its own dates, not the whole
   unit** — `holds_active_room_no_overlap` (migration 084, an exclusion constraint on dates copied from the
   quote by trigger); 23P01 maps to a plain 409. (c) **A HIGH/CRITICAL repair may carry `blocks_from` /
   `blocks_to`** (migration 085, half-open): with dates it blocks only those nights and leaves the unit's
   status alone; without dates the unit is MAINTENANCE for every date as before. Every "is it free" reader
   uses `core/availability/repairWindows.ts` — the three availability queries and `checkAvailability`.
   (d) **Payroll is costed to ONE home property per person** (`staff_compensation.home_property_id`,
   migration 086, defaulting to their first property by name); every posting splits by home, so two
   accountants posting their own properties never charge the same person twice. Staff with no property are
   the company-level cost. (e) **A website enquiry names its property** (`/enquire` asks when there's more
   than one; "Not sure" stays unassigned). (f) **Moving an in-house guest opens a cleaning task** for the
   vacated unit (`openTaskOnCheckout`, same transaction).
   **R5 retest (2026-10-04).** (a) **No Idempotency-Key ≠ no protection**: `idempotent()` uses the
   request's own fingerprint as an implicit key for 10 s, so a double click replays the first answer
   (an explicit key still lasts 24 h). (b) **A second guest with an email already in use is a question**
   (409 `error: 'Duplicate Email'`, never naming the other guest) answered by "Save anyway"
   (`allow_duplicate_email`). (c) **Holds and bookings are checked both ways**: an edit can't move onto a
   bare hold's nights; a bare hold can't sit on a booked or repair night. (d) **Every list uses
   `parsePageQuery` / `parseLimit`** — no hand-rolled clamping. (e) **Audit rows carry their property**
   (`audit_logs.property_id` / `scope_kind`, migration 088, set by trigger via `audit_property_of`); the
   activity feed reads two index-ordered streams instead of resolving every row. Guests ('C') are still
   resolved at read time.
   **R6 (2026-10-05).** (a) **The public /stay page never reveals who owns an email**: an existing guest
   record is reused only when email AND phone (digits) both match; otherwise a new contact is created from
   what was typed and noted as a possible duplicate. The reply always carries the typed name.
   (b) `forwardOccupancy` counts only real bookings (`CASE WHEN res.id IS NOT NULL` — LEAST/GREATEST
   ignore NULLs) and, per D02, includes PENDING; nudges are capped at 100%.

   **Stage 3 (2026-10-03).** Cash reports (`revenueBy*`, `vatOutput`) count `PAID` **and `REFUNDED`**
   receipts (refund rows negative) and date money by **when it moved** — the paying intent's
   `paid_at`, else the invoice's `created_at` (`CASH_AT` in `reports.repository.ts`). This moves
   historic monthly cash figures for invoices settled after they were raised. A date/unit edit on a
   live booking that is confirmed or has money moves its agreed price by the **delta** (new stay −
   old stay, both at today's rates) — never a full re-price. Since Round 4 that delta is applied **inside the
   same transaction as the edit, under a row lock on the booking** (`ReservationsRepository.update` →
   `repriceStayChange`), to the *locked* folio — so concurrent edits queue instead of each applying a delta
   from a stale read, and a result that would go below zero (earlier refunds) refuses the edit (409) rather
   than being clipped to P0.

   **Round 4 — money integrity (2026-10-04).** (a) **Every writer of a booking's money takes the booking
   row lock** (`FOR NO KEY UPDATE`: date edits, discounts, payments, refunds) — don't read a folio, then
   write it, outside that lock. (b) **A unit or guest with live bookings or open invoices can't be
   deleted** (409 in plain English, `core/integrity/liveBookings.ts`); a booking never disappears because
   its unit/guest was soft-deleted. Review any already-stranded bookings with
   `npm run db:repair-orphaned-bookings` (report only; `:apply` is owner-run, never automatic).
   (c) **Refunds** are capped by what is left on the invoice *and* by the folio credit when a stay was
   shortened after payment; the same amount on the same invoice by the same user within 10 s without an
   `Idempotency-Key` is refused as a duplicate. The refund-lowers-the-total rule and what a full refund
   does to the booking are unchanged. (d) **`Idempotency-Key`** (optional header, migration 081): mount
   `idempotent()` after `validateBody` on any POST that moves money or creates a billable record
   (refund, `/payments`, mark-paid, operating-expenses, contacts). Same key + same request → the stored
   answer is replayed; same key + different body → 422; only 2xx answers are stored; keys last 24 h. The
   web sends one key per dialog open (`newIdempotencyKey()`), and buttons disable while in flight.
   (e) **Web Pula inputs go through `pulaToThebe` only, which is strict**: dot decimals, ≤ 2 places, no
   commas or spaces (`"10,5"` is NaN, not P105). Show `<AmountError>` under the box. (f) A discount can
   only be added to a PENDING booking; the drawer says so instead of offering a form that 409s.

   **R6 — should-fix (2026-10-05).** (a) **Every paged list breaks ties on `id`** after its sort column —
   rows sharing a timestamp otherwise repeat or vanish between pages. (b) **A cancelled booking still
   holding money can't be removed** (`ReservationsRepository.softDelete`, under the row lock). (c) **A
   HIGH/CRITICAL repair over booked or bare-held nights is a question** (409 `error: 'Repair Overlap'`,
   answered with `confirm_overlap`, which releases the bare holds it covers; bookings are never moved
   automatically). (d) A contact edit only re-checks the email when it changed. (e) Replayed money POSTs:
   the web reads `Idempotent-Replayed` and says "already recorded" instead of a second success.
   (f) **Never edit an applied migration** — postgres-migrations refuses a changed hash and the API won't
   boot. A large backfill goes in a NEW migration, in batches, deployed in a quiet window.
   **R6 — low (2026-10-05).** (a) **One live contact per email** unless someone chose "Save anyway":
   `contacts_email_unique` (migration 089, partial on `lower(email)` where `NOT email_shared`); a 23505 on it
   maps to the same 409 'Duplicate Email' question, so six parallel saves make one guest. (b) **Revenue
   recognition takes a per-booking lock** (`RevenueRepository.lockedFor`) and re-reads before booking,
   so the sweep and an after-write call can't both book the same night. **R7 N7-1 (critical):** the lock
   is `pg_advisory_xact_lock` inside ONE transaction, and the callback may use only the repository it is
   handed — pricing happens *before* the lock. Never hold a pooled connection while asking the same pool
   for another: R6 did, and ten concurrent booking writes froze the whole API. The pool also fails a
   request after `DATABASE_POOL_ACQUIRE_TIMEOUT_MS` (15 s) instead of hanging it forever. (c) A check-out can't be dated
   after today (Gaborone day), same as check-in. (d) **P&L `vat_output` follows the basis** — earned VAT on
   accrual, collected VAT on cash. (e) Repair dates are real days in 2000–2099, at most 366 nights apart.
   (f) Housekeeping times show in Gaborone time (`propertyMoment`). (g) The workspace switcher only offers
   workspaces with a screen the user can open (`workspacesFor`). (h) An unpaid PENDING check-in stays
   allowed — that is invariant 3, not a bug.
   **R7 (2026-10-05).** (a) **Taking a unit off sale is a question when guests are still booked into
   it**: `/rooms/:id/maintenance` and `/out-of-service` answer 409 `error: 'Unit Has Bookings'` while bookings
   or live bare holds lie ahead, unless `confirm_overlap`; then bare holds are released and bookings stay
   put for staff to move (`RoomsRepository.closeUnit`, under the unit's row lock). (b) The public booking
   page retries its guest lookup once when a parallel booking just took the same new email (23505 on
   `contacts_email_unique`), so the loser becomes a reused or flagged record, never a generic clash.
   (c) `email_shared` follows the email: true only when "Save anyway" was used AND another live guest
   really has it; a changed email decides it afresh.
   **R8 (2026-10-05, UX).** (a) The Units "still has bookings" question opens under that unit's row and
   names it. (b) A fully refunded booking's badge reads "fully refunded", not "paid". (c) **Refund from the
   booking** (`RefundFromBooking` in the reservation drawer, read-only cancelled view included): offered
   with `invoices.refund` on a cancelled/no-show booking still holding money or a live one paid beyond its
   total; it refunds the latest receipt with something left (`folioInvoices` now returns
   `refunded_amount`). (d) Cockpit guest rows stay stacked up to `2xl`, since from `lg` the rail is three
   narrow columns.
   **Small improvements (2026-10-05).** (a) Public phone matching compares international digits
   (`digitsOf` in `public.service.ts`: +267 assumed for a locally written number), so "071 234 567" is
   the same person as "+267 71 234 567". (b) **A website enquiry with an email already on file stays with
   that guest only when plainly the same person** (same phone, or same name when no phone was given);
   otherwise a new `email_shared` record noted as a possible duplicate. (c) Marketing segments count and
   list **one entry per email** (`onePerEmail`, the record with the most stays stands for it).
   (d) `CallButton` (tel:) sits beside every `WhatsAppButton`.

✅ **Answered 2026-09-07 (D02):** `reports.forwardOccupancy` now counts PENDING as demand. Since
D01 a held night is unsellable, so excluding it let the nudge advertise rooms nobody can book.
**Forward view only.** `occupancyByProperty`, `occupancyByMonth` and `occupancyByOwnedRoom` are
*historic* occupancy and still exclude PENDING on purpose: a past held night is one nobody slept
in, and counting it would inflate ADR's denominator and put phantom nights on a landlord's
statement. Do not "align" those three without asking.

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
  JWT **`sub`** claim, not `id`. (H7) The token also carries **`sid`** (its login session); `authenticate`
  refuses it once that session has no live refresh token, the user is inactive, or the role/permissions
  it claims have changed — so logout, deactivation and demotion bite on the next request. Permissions are dotted verbs: `crm.leads.read`,
  `reservations.discount.approve`. Multi-tenancy via the `x-property-id` header → `req.activePropertyId`.
- **Validation:** Zod v3. Schemas live in the module's `.types.ts` as `PascalCaseSchema`, with
  `export type XDTO = z.infer<typeof XSchema>` beside them. `UpdateXSchema = CreateXSchema.partial()`.
- **Migrations:** plain SQL in `src/db/migrations/`, strictly `NNN_snake_case.sql` (at 089). Open with a
  comment block explaining *why*. **Adding one means hand-updating `src/db/types.ts`** — the Kysely
  `Database` interface is hand-written, not generated.
- **Process time zone is UTC (round 4):** `config/env.ts` pins `process.env.TZ = 'UTC'` first thing, so
  `DATE` columns, `Date` parameters and JSON output are identical on a laptop, in CI and on Render.
  Business days still come from the Africa/Gaborone helpers in `core/time.ts` — never from the process zone.
- **Lists:** `parsePageQuery` (`core/http/pagination.ts`) is the one `?page=&limit=` rule — `limit` 1–100,
  anything else is a 400. Small "everything" lists use `pageOf` (opt-in paging, default unchanged).
- **Revenue ledger:** `recogniseRevenueAfterWrite` (revenue module) books a stay's revenue right after any
  successful booking/payment/invoice/hold write; the hourly sweep is only the safety net.
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

## Access and property scope (Round 4)

Who may see what, beyond "do they hold the permission". Read this before adding a list, a report or a
write endpoint that touches property data.

- **"All-property" access** = an admin, or a user who is a member of *every active property*
  (`propertyScopeForUser` in `core/scope/propertyScope.ts` → `{ ids, allProperties }`). Everyone else is
  *limited* to the properties they belong to (`user_properties`). A limited user must never see, change or
  create data outside those properties — a request for someone else's row is a 404, not a 403 with details.
- **Company-level (NULL-property) rows** (costs with no property, unfiled uploads, leads nobody assigned)
  are visible to all-property users only; a limited user sees such a row only if they created it. The P&L
  says so in a `scope_note` field when it leaves them out. Payroll is costed per *home* property (R5):
  a limited user posts only the homes in their properties and never creates a NULL-property cost.
- Scope lives in the **repository query** (before `LIMIT`), not in the controller after the fact. The
  activity feed scans newest-first in chunks and runs with `SET LOCAL jit = off` — a big `CASE` over the
  audit table was spending ~1 s in JIT compilation; check `EXPLAIN` before assuming an index is the fix.
- Every money field has a ceiling: `MAX_MONEY_THEBE` (P1,000,000) in `core/money/limits.ts`. A rate ladder
  must not go down (weekly ≥ nightly, monthly ≥ weekly) — the price engine would sell a night as a week.
- Web: every signed-in route is guarded by `RouteGuard` (the AppShell wraps its `<Outlet/>`), keyed by
  `permForPath` in `components/layout/nav.ts`. `router/routeGuards.test.tsx` fails if a route is added
  without being listed there, so add the page's API permission when you add a route. Role permissions in
  `test/rolePermissions.ts` are a snapshot checked against the DB by an API test.

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

✅ **Render paid plans live 2026-09-20** — web service (`starter`) + Postgres (`basic-256mb`) in
`render.yaml`; API is always-on (~0.5s `/health`, no cold start). Before that, free Postgres was
due to expire ~Sep 2026 and the sleeping web tier broke Booking.com's iCal fetcher — see
`DEPLOY.md` and `GO-LIVE-FAHAD.md` Part A for context.
