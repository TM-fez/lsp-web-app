# LSP Gap Register

Everything the app does not yet fully cover, measured against the client's operations process map
(Figma FigJam: *Lifestyle Apartments Current Operations Process Map*).

The board has **56 process steps**. As of this audit: **24 fully in the app, 17 half-built,
15 still manual**. This file lists the 32 that are not done, in board order.

Refs `G01`–`G32` are stable — use them in commits, branches and conversation.

**Status** — `HALF` something exists but the loop isn't closed · `OUT` nothing covers it.
**Action** — `Build` ready to schedule · `Decide` needs a business call first · `Blocked` waiting on someone else.
**Size** — `S` a day or two · `M` about a week · `L` several weeks. Rough shape, not a quote.

Audited against `main` @ `2c54c41` (2026-08-20) — 31 API routers, 62 migrations, 31 web routes, 93 test files.
Re-audited **2026-09-08** against `main` @ `63a0e89` — **31 API routers, 69 migrations, 32 web routes,
115 test files**, PRs to #111. Every G-item and D-item below was checked against the code on that
commit, not carried forward on trust. Two things moved: **D06 was fixed in PR #105 but still read
`OPEN` here**, and **G15 changed shape** now that the revenue ledger exists (see its entry). The
remaining Start-here items were each confirmed still undone in the code.

---

## The pace this is being built at

**Confirmed by the owner 2026-09-08: the app is not carrying real bookings yet.** It is being tested
slowly and deliberately while the business works out how it fits. Production holds **two** bookings
(four nights, both priced by reconstruction) — they are test bookings. Little Hotelier is still the
live system; see G32.

This is context, not a problem, and it changes how everything below should be read:

- **Nothing here is urgent.** The priorities are advisory. There is no deadline being missed and no
  blocker to clear — the slow pace is the plan, not a symptom of one.
- **Reporting gaps are the least urgent of all.** G13, G15, G03 and the revenue half of G30 all
  report over transaction data that does not exist yet. They will be correct when volume arrives;
  building more of them now is measuring an empty room.
- **Slow real use is what finds the defects.** Every item in the defect section below came from
  someone using the app, not from reading it: D01 was a real "looked free, got 409"; the three bugs
  fixed while building G30 were found by running the backfill against real data, one of which was
  recognising 3,027 nights at P0.00 because *cannot price it* was being read as *it earned nothing*.
  That is the pace working, and it argues for keeping it.

⚠️ **Do not infer urgency from a number reading zero.** On 2026-09-08 an empty revenue ledger was
briefly read as a broken P&L, and a case was built for an emergency backfill; the real answer was
that there is no revenue in the system yet, by design. Before treating a low figure as a defect,
check whether anything has been entered that should have produced it.

---

## Build order

Ordered **2026-09-09** against `main` @ `2ac888b`. The register lists gaps in *board order*, which is
the right order to audit in and the wrong order to build in — so this is the sequence, and the reason
for it. The entries below are pointers: the detail stays in the G-item and must not be restated here,
because a second copy is a second thing that rots. When an item ships, close its own entry in the same
PR (`HANDOVER.md` §8, rule 1) and strike it here.

**Wave 0 — before any more code.** Neither is a build; both decide whether a live number can be
trusted at all.

1. **Confirm the G30 backfill has been run against production.** `HANDOVER.md` §5 still marks this
   unverified. The ledger starts empty and `/reports/pnl` now defaults to accrual, so until it runs
   the live P&L reads near-zero revenue — and reads it as a fact rather than as an absence.
2. **Tell the owner about D08.** Some historical cash months restate. Announced beats discovered.

**Wave 1 — close what is half-shipped.**

3. ~~**Draw `/reports/revenue`.**~~ ✅ **done 2026-09-09** — the endpoint had shipped in #111 with no
   consumer, and an unconsumed endpoint rots. That was a code-health reason rather than a
   reporting-value one, which is what earned it a place above the pace note’s caution on reports.
4. **G15** — rides the page built directly above it, on the accrual basis.

**Wave 2 — pilot workflow polish.** The cheap half of *Start here*, ordered by pilot value. Slow real
use is what finds the defects, so items that make the app *usable* outrank items that *report* on it:
**G23** (screen only — the plumbing is already in) → **G20** → **G21** → **G12** → **G18**. G18 comes
last of the five deliberately: the long-term leasing branch forks off it, so it is the bridge into
Wave 5. **Put D07 to the owner while working G20/G21** — this file already says to decide it with
them, and Wave 4 cannot start until it is decided.

**Wave 3 — deferred reporting.** **G13**, **G03**, **G16**. Cheap and unblocked, but they report over
transaction data that does not exist yet — see the pace note above. Schedule them when the pilot
carries real bookings, not before. Building them now is measuring an empty room.

**Wave 4 — the calendar.** **D07** first, as a hard prerequisite, then **G32** — whose
`booking_group_id` migration has to be designed in rather than bolted on afterwards. This is the wave
that ends the Little Hotelier subscription, so its deadline is set backwards from the renewal date,
which nobody has yet (decision 3).

**Wave 5 — long-term leasing.** **G22+G19** → **G26+G25** → **G24**. One lease record underneath all
of them; build it once. Gated on decision 4.

**Not schedulable** — blocked, or waiting on a decision. Listed so their absence from the waves reads
as deliberate rather than forgotten: G27/G28 (KYC), G10 outbound (Meta template — note that *inbound*
is buildable today and is the bigger prize), G04/G06/G07/G14 (one decision, not four builds), G08,
G31, G09, G11, G01, G02, G05, G17, G29, and D04.

---

## Start here

Small, unblocked, needs nobody's permission. Clearing these closes eight of the thirty-two.
(One is already struck through — G28's standalone half shipped on 2026-09-01.)
Sequenced in **Build order** above: this table is *what* is cheap, that section is *when* it is done.

| Ref | Item | Why it's cheap | Verified 2026-09-08 |
|---|---|---|---|
| G15 | Direct vs OTA revenue | Source is on every booking — **and now on every recognised night** | no report groups by source |
| G13 | Conversion rate | Leads already carry source and outcome | only migration 060 exists; no report |
| G20 | Maintenance inspection | Copy the sign-off housekeeping already has | no `inspect` in `modules/maintenance` |
| G23 | Payment proof | Settle endpoint already accepts a receipt file | `InvoicesPage.tsx:194` still settles with no file |
| G18 | Stay type | One field on the booking | no `stay_type` anywhere in API or web |
| ~~G28~~ | ~~Discount fix~~ | ✅ done, PR #94 — the charge now uses the discounted total | — |
| G12 | Stale lead alert | Reuse the existing reminder sweep | sweep has stale *quotes* and *maintenance*, not leads |
| G21 | Post-checkout link | Tie a departure-day repair to the departing guest | no guest/reservation link on a work order |

### Why none of these have been done — and that being right

Four consecutive work sessions (2026-08-31, 09-01, 09-07, 09-08) skipped this list entirely and went
to the money instead: the folio (G27), pay-later (G28), the accrual ledger (G30), and nine defects.
That looks like the list being ignored. It is worth writing down that it was not a drift — it was the
correct call, made four times without being recorded once, which is why it *felt* like drift.

The reason: every item on this list is **reporting or workflow polish that depends on nothing**, so it
keeps. The money work was **load-bearing and ordered** — the folio has to exist before a booking can be
confirmed unpaid, and pay-later has to exist before accrual revenue means anything. Doing G15 first
would have built a revenue-by-source report on the cash basis, then had to rebuild it two weeks later
on the ledger.

**What follows for the next session:** this list is now genuinely next. Nothing else is queued, nothing
above it is half-finished, and the ordering argument that outranked it has run out — the revenue book
is closed. The one thing that legitimately jumps the queue is drawing a page for `/reports/revenue`,
because that endpoint shipped in #111 with no consumer and an unconsumed endpoint rots.

**G15 changed shape and got better.** It was "group invoices by `reservations.source`" — a cash-basis
answer. `revenue_recognition` carries `reservation_id`, so the same report now joins through to source
and answers it **per night on the accrual basis**, consistent with the P&L beside it. Still `S`, still
the cheapest answer to the most commercially loaded question on the board, but no longer a number that
disagrees with the P&L.

---

## Strategy

### G01 · Market Intelligence · `HALF` · Decide · M
- **Today** — the AI strategy brief reads own occupancy, revenue and margin.
- **Needed** — outside data: competitor rates, local demand. Also stays dark until `ANTHROPIC_API_KEY` is set.

### G02 · Marketing Strategy · `HALF` · Decide · M
- **Today** — AI brief plus rule-based occupancy nudges (`reports.nudges.ts`).
- **Needed** — a strategy that can be saved, versioned and assigned, not regenerated each time.

### G03 · Targets & Budget · `OUT` · Build · M
- **Today** — nothing; targets and budgets live in spreadsheets.
- **Needed** — occupancy and revenue targets per property per month, shown beside actuals on `/reports`.

## Execution

### G04 · Campaign Planning · `OUT` · Decide · L
- **Today** — no campaign record exists anywhere in the schema.
- **Needed** — a campaign with dates, audience, channel, budget, owner. G06, G07 and G14 all depend on it.

### G05 · Content Production · `HALF` · Build · S
- **Today** — `/marketing` drafts campaign copy per segment and channel via the LLM.
- **Needed** — persist the draft, keep versions, attach it to a campaign. Today it is lost on page close.

### G06 · Campaign Approval · `OUT` · After G04 · S
- **Needed** — Tameem approves before spend, mirroring the existing discount-approval rule.

### G07 · Campaign Launch · `OUT` · Decide · L
- **Today** — the app cannot send. Copy is pasted by hand into whatever sends it.
- **Needed** — either sending from the app, or an honest hand-off to a tool that does it well.

## Channels

### G08 · Booking.com · `HALF` · Decide · L
- **Today** — iCal busy/free sync both ways (migrations 046/047, `/ical`).
- **Needed** — rates, content, real-time confirmation. This is the strategic OTA call, not a small build.

### G09 · Social Media · `OUT` · Decide · M
- **Today** — no integration. A DM enquiry is retyped by a person or lost.
- **Needed** — at minimum a fast path to log a social enquiry as a lead.

### G10 · WhatsApp · `HALF` · Blocked + Build · M
- **Today** — outbound alerts built but deliberately dark (`channel.whatsapp.ts`, gated on `WHATSAPP_LIVE`) pending Meta template approval.
- **Needed** — two things: flip outbound on when the template clears, and build **inbound** so a WhatsApp enquiry becomes a lead without retyping. Inbound is the bigger prize — it is where enquiries get lost today.

### G11 · Corporate Sales · `HALF` · Build · M
- **Today** — corporate tags on leads and reservations; separate billing contact (migration 057).
- **Needed** — the company itself: account record, negotiated rates, contract terms. Corporate is a main customer source.

## Demand Operations

### G12 · Lead Nurturing · `HALF` · Build · S
- **Today** — leads move NEW → CONTACTED → QUALIFIED with owner and source.
- **Needed** — nothing chases a lead that goes quiet. Stale-lead alert at minimum; follow-up sequence ideally.

## Performance

### G13 · Conversion Rate · `OUT` · Build · S
- **Needed** — enquiries in vs bookings out, by channel. The data exists; this is a report, not a feature.

### G14 · Campaign ROI · `OUT` · After G04 · S
- Unreachable until campaigns and marketing spend exist. Do not schedule separately.

### G15 · Direct vs OTA · `OUT` · Build · S
- **Today** — `reservations.source` is recorded on every booking; no report groups by it.
- **Needed** — revenue split by source, with commission saved on direct. Cheapest answer to the most commercially loaded question on the board.

### G16 · Optimization · `HALF` · Build · M
- **Today** — occupancy nudges and the AI brief both suggest actions.
- **Needed** — nothing records whether a suggestion was acted on or worked, so the advice never improves.

## Retention

### G17 · Retention · `HALF` · Build · M
- **Today** — automatic post-stay email (059); guests segmented VIP / frequent / recent / lapsed; each contact carries a real `previous_stays` count migrated from Little Hotelier (062); segments open to show their members.
- **Needed** — capture the reply. **Still no reviews or ratings table**, so the loop back into Market Intelligence carries no sentiment. The "repeat guests tracked from memory" problem is solved; this is what remains.

## Demand & Reservation → Stay type

### G18 · Determine Stay Type · `HALF` · Build · S
- **Today** — no stay-type field. Length is inferred at 28 nights, and only to fire a renewal reminder.
- **Needed** — short stay vs long term as an explicit choice. The board's whole right-hand branch hangs off this fork.

### G19 · Monthly Invoice · `OUT` · Build · with G22
- Same capability as G22 seen from the booking side. Treat as one job.

## Accommodation Operations & Maintenance

### G20 · Inspection · `OUT` · Build · S
- **Today** — a technician marks their own repair COMPLETED and the unit returns to service.
- **Needed** — a sign-off step mirroring `housekeeping.inspect`. Repairs are done by outside contractors, so this is an accountability control.

### G21 · Post-checkout Issue · `HALF` · Build · S
- **Today** — you can raise a maintenance request after a guest leaves.
- **Needed** — it is indistinguishable from any other job; no link back to the departing guest, so damage cannot be traced or recovered.

## Long-Term Leasing

### G22 · Monthly Rental · `OUT` · Build · L
- **Today** — no lease record. A six-month tenant is a booking with a distant check-out date, so rent is invoiced by hand every month.
- **Needed** — a monthly rent run. Migration 043 already generates recurring monthly entries idempotently for operating *costs*; same machine pointed at rent income. Pricing is not the problem — rate plans already carry `monthly_rate` and `pricing.service` decomposes a stay into month/week/night blocks.

### G23 · Payment Proof · `OUT` · Build · S
- **Today** — tenants send a bank slip on WhatsApp; someone eyeballs it and clicks Settle. The slip never reaches the system.
- **Needed** — only the screen. `POST /invoices/:id/settle` already accepts `receipt_file_id`; `InvoicesPage.tsx` calls `settle.mutate(inv.id)` with no file. Plumbing in, tap not fitted.

### G24 · Receipt of Funds · `HALF` · Build · M
- **Today** — payments and invoices recorded, emailed, printable.
- **Needed** — matching a payment that landed in the bank to the right tenant and month. Done from memory today.

### G25 · Lease Renewal · `HALF` · with G26 · S
- **Today** — a nudge fires 7 days before a long stay (≥28 nights) ends. This part works.
- **Needed** — the nudge is useless alone because acting on it is G26.

### G26 · Renew Lease · `OUT` · Build · M
- **Today** — no renew action; acting on the nudge means typing a whole new booking.
- **Needed** — extend the tenancy in place: new term, new rate, same tenant, history intact. Needs the lease record from G22.

## Revenue Capture

### G27 · Payment · `HALF` · Blocked · L
- **Today** — full machinery built: payment intents, retries, hold release on failure. Public bookings are pay-on-arrival.
- **Needed** — a real gateway. Blocked on the client registering the business, opening a bank account and passing KYC for DPO. Code side largely ready: deposit → createToken → hosted checkout → return + server callback → verifyToken → existing `settlePaid()`.

### G28 · Confirmation Payment · `HALF` · Build · S
- **Today** — a successful payment auto-confirms the booking, but success is typed in by a person. Staff can now record an off-system payment against an existing booking (`POST /reservations/:id/mark-paid`, PR #94), which raises a paid receipt and — since PR #96 — an unpaid invoice for any remainder.
- ✅ **The standalone discount half is done** (PR #94): the amount charged defaults to the booking's own priced total, which has the approved discount already applied. It no longer reduces only what is displayed.
- **Needed** — the rest resolves with G27 (a real gateway).

## Financial Recording

### G29 · Accounting Responsibilities · `HALF` · Build · S
- **Today** — roles and per-property access decide who can see what.
- **Needed** — who must *do* what, and by when: the month-end checklist. Accounts is two people; the process should not live in their heads.

### G30 · Accounts Processing · `HALF` · Build · L
- **Today** — expenses, operating costs, payroll, receipts and invoices all captured.
- ✅ **Boundary decided 2026-09-07: LSP is the book of record for revenue.** The owner's driver was a P&L that reads correctly month by month — revenue earned in September must show in September even when the guest pays in October, and October's payment must then show September's debt as settled.
- **Consequence** — revenue moves from cash-basis to **accrual**, recognised per night. Today's `/reports/pnl` is a *hybrid*: cash revenue against accrual costs (`operating_expenses.incurred_on`, `maintenance_work_orders.opened_at` are already accrual). That is the real reason the monthly margin does not read correctly — the two sides of the same month are measured on different clocks.
- **Scope taken now** — the nightly revenue ledger, earned/received views, receivables and aging. Plus two pieces of accounting hygiene pulled forward because they cannot be retrofitted: gapless invoice numbering (D09) and void-instead-of-delete on posted documents.
- **Deliberately deferred** — period close and credit notes. The recognition ledger is *versioned* (supersede, never update in place), which is the structure period close needs, so adding it later is a new table and a rule rather than a rewrite. Tracked under G29.
- **Known limit, must be said on screen** — the backfill prices historic stays at *current* rates, because rate plans have no effective dating. Figures before go-live are reconstructed, not recovered.
- **Built 2026-09-08** — the ledger (`revenue_recognition`, migration 069): one row per booking per night, versioned by supersede, live rows are `superseded_at IS NULL`. Earning statuses are CONFIRMED / CHECKED_IN / CHECKED_OUT — PENDING holds the room (invariant 7) and counts as forward demand (D02) but earns nothing, which is where the money axis and the lifecycle axis part company. One write path, `reconcile()`, which compares desired against live and leaves an agreeing booking untouched, so it is idempotent.
  - **The nightly sweep** rides the existing scheduler, self-gated to a day, over a rolling window (`REVENUE_LOOKBACK_DAYS` / `REVENUE_LOOKAHEAD_DAYS`). *Withdrawing* recognition is deliberately unwindowed — a stay cancelled long after the fact must stop earning whenever that happens. It recognises only **agreed** totals: no pricer is wired, because reconstructing nightly would restate every unfrozen booking each time a rate moved.
  - **The backfill** (`npm run db:backfill-revenue`, dry run by default, `--yes` to apply) is the run with no window and a pricer wired. Verified against 295 demo bookings: 3,027 nights / P3,219,645 recognised, re-running changed nothing, and doubling one rate restated exactly the 61 bookings on that plan — which is the reconstruction caveat, demonstrated rather than asserted.
  - **The reporting** (2026-09-08) — `/reports/pnl` now defaults to **ACCRUAL**, closing the hybrid: both sides of a month are finally on the same clock. The cash basis stays reachable at `?basis=cash` for reconciliation, and every response carries `revenue_basis`, so which clock a figure is on is never inferred. New `/reports/revenue` gives earned vs received month by month — the gap between the columns is the accrual receivable, and before the ledger the question could not be asked because both numbers were the same number.
  - **Said on screen, as promised** — the Reports page names the basis on the revenue tile and carries two warnings under it: how much of the figure is a reconstruction (in Pula and percent), and whether any earning stays are missing from it entirely. That second one is the difference between "a quiet month" and "the backfill has not been run" — without it an un-backfilled deployment reads as a real revenue collapse.
  - ⏳ **Still open** — invoice-level debtor ageing stays on `/finance`, reading `invoices` directly (see D04).
- ✅ **The view is drawn (2026-09-09).** `/reports/revenue` now has a page: earned vs received month by
  month, the running difference labelled by sign (positive is a receivable, negative is cash taken for
  nights not yet slept — both are normal and conflating them would report money that is not coming), and
  a CSV export that carries the disclosure in its header rather than dropping it at the export boundary.
  The two promised accrual warnings moved into a shared `AccrualWarnings` component used by both this
  page and the P&L, so the wording cannot drift between the two screens quoting the same ledger.
- **Found while building it** — `priceable: false` (a unit type with no active rate plan) was being read as a total of zero, which recognised every night of every such stay at zero. The first real backfill run put 3,027 nights into the demo ledger asserting that confirmed stays were free. "Cannot price it" and "it earned nothing" are now different answers: the first is skipped and counted as unpriced, and the sweep logs that count at WARN. `getFolio()` still answers 0 for the same case on purpose — it is a display fallback so the drawer does not blank, and nobody reconciles a month from it.

### G31 · Banking · `OUT` · Build · L
- **Today** — no bank account, statement import or reconciliation. Reconciliation happens by hand every Monday.
- **Needed** — at minimum import a bank statement and match against invoices. The board's Cash/POS Reconciliation and Payment Verification arrows have no counterpart in the software.

### G32 · Little Hotelier · `OUT` · Build · M
- **Owner decision 2026-09-07** — replace the Little Hotelier **calendar** in LSP. It is the last screen keeping the subscription alive, so the calendar's deadline should be set backwards from the renewal date.
- **A walk-in taking several apartments is ONE bill, not one per apartment.** That is a real constraint on the build: `reservations` has no `booking_group_id`, so four units today means four bookings, four folios and four invoices. Grouping them needs a migration and must be designed in, not bolted on afterwards.
- **Evidence gathered** — the owner does not have access to pull a screenshot of their own calendar, so the vendor's published product illustration was used instead. Its legend is the useful part: **Confirmed · Checked-in · Checked-out · Room closed · Incomplete payment**. Two things follow. (1) *Incomplete payment* is a first-class state on their calendar, which is exactly the pay-later work in G27/G28 — the folio feeds it directly. (2) *Room closed* is a date-ranged maintenance block, which LSP cannot express at all (**D07**). Parity needs it.
- ⚠️ **Treat that legend as indicative, not specified.** It is marketing artwork, not a screenshot of the owner's account, and everything else about their calendar (rate rows, an unassigned tray, whether a drag confirms) remains unknown. Ask before building anything that depends on it.

### G32 · Little Hotelier (original board entry) · `OUT` · Decide · S
- **Today** — drawn on the board as a live step, now clearly out of date. The guest list is already migrated off (~1,300 contacts, stay counts preserved, migrations 061/062). The app still has no integration, by design.
- **Needed** — a date, not a build. The data rescue is done and as complete as it will ever be: the export carried no dates or amounts and the owner can no longer pull them. Decide when the subscription stops; take the box off the map.

---

## Found in the code, not on the board

**Nine defects, seven closed.** Open as of 2026-09-08: **D04** (`PARTIALLY_PAID` written by nothing —
a deliberate hold, not a bug to fix today) and **D07** (no date-ranged maintenance block — needs a
decision, and is a hard prerequisite for G32's calendar). Both are `Decide`, so neither is picked up
without asking. Everything else here is resolved and kept for the reasoning, not the status.

### D01 · "Looked free, got 409" · ✅ `RESOLVED` 2026-09-01 (PR #99)
- **Was** — two definitions of "blocked" live at once. `checkAvailability` and the `reservations_no_overlap` constraint blocked on PENDING; the availability engine counted only `('CONFIRMED','BLOCKED')` + CHECKED_IN occupancy. A unit with a PENDING booking read as free in search, then 409'd on create — worst on public `/stay` bookings, which sit PENDING up to 24h.
- **Owner decision** — **an unpaid booking DOES hold the room.** All three now agree; the rule is recorded as invariant 7 in `CLAUDE.md` with the three places that must move together if it is ever reversed.
- **Consequence, deliberate** — `EXPORTABLE_STATUSES` gained PENDING, so a held night publishes to Booking.com as busy. Over-blocking loses a booking if the hold expires; under-blocking loses a guest's room. One constant to flip if the balance proves wrong in practice.
- **Guarded by** — `availability-d01.test.ts` asserts the *invariant* (search and booking never disagree), not the rule, so a reversal fails loudly rather than reopening the divergence elsewhere.

### D02 · Unpaid nights are not "demand" in forward occupancy · ✅ `RESOLVED` 2026-09-07
- **Was** — `reports.forwardOccupancy` counted `('CONFIRMED','CHECKED_IN','BLOCKED')`. Since D01 a PENDING night is unsellable but was still absent from the nudge, so it could say "you have space" about a room nobody can book.
- **Owner decision** — **yes, a held night is demand.** PENDING joins the forward-occupancy set. The asymmetry runs the same way D01 already chose: over-counting costs a discount you needn't have offered, under-counting costs a room you promised twice.
- **Scoped to the forward view only.** `occupancyByProperty`, `occupancyByMonth` and `occupancyByOwnedRoom` are *historic* occupancy and still exclude PENDING: a past held night is one nobody slept in, and counting it would inflate ADR's denominator and put phantom nights on a landlord's statement.
- **What it moves** — the nudge thresholds only. Nothing on the P&L, nothing on an owner statement, no number the owner reads as money. That is what made it a cheap call.

### D03 · The activity feed is not property-scoped · ✅ `RESOLVED` 2026-09-01 (PR #101)
- **Was** — a Village user read CBD's activity. `/activity` was gated on `activity.read` (066) so contractors were out, but there was no property filter.
- **Fixed** — the property is resolved at READ time, walking each entity down its own chain to a building (reservations, rooms, housekeeping tasks, work orders + costs, occupancy, holds, invoices, payment intents, buildings, properties, operating expenses, channel collisions). One rule: `coalesce(resolved, :propertyId) = :propertyId` — resolves to a property, must match; resolves to nothing, it is house-wide and everyone sees it. The route now takes `requireActiveProperty`, the same gate the cockpit board beside it already used.
- **Accepted, documented** — an audit row whose entity was HARD-deleted resolves to NULL and reads as global. Soft deletes are unaffected. Hiding such rows would quietly lose history, which is the worse trade.

### D04 · `PARTIALLY_PAID` is a status nothing writes · `OPEN` · Decide · S
- **Note 2026-09-08** — unchanged by G30. The accrual ledger answers "what is owed for nights already provided" at the *month* level (`/reports/revenue`); this is about a single invoice's part-payment, which still has no amount column. The two do not overlap.
- **Today** — read by the finance queries, the UI badges and the status filter; written by nothing. A part payment produces a fully-PAID smaller invoice plus an ISSUED balance (#96) instead.
- **Needed** — leave it or remove it. Removing means rebuilding a Postgres enum type, which is real work for no functional gain today.
- **Annotated 2026-09-07** — **keep it, still unwritten, for now.** The owner asked for "P500 of P1,500 paid", and that is answered at the *reservation* level by the folio (derived from invoices), not by this status. Writing `PARTIALLY_PAID` today would be actively wrong: there is no part-payment amount column, so `finance.repository.ts` counts such an invoice's **full** value as outstanding — it would inflate the receivables ledger and every aging bucket. It earns its place when `payments` + `payment_allocations` land (G30 scope), at which point `outstanding = total − Σ allocations` makes the status true. Until then the folio arithmetic must live in **exactly one SQL helper**, so that swap is one query rather than a hunt.

### D06 · Availability's occupancy join has no date predicate · ✅ `RESOLVED` 2026-09-07 (PR #105)
- **Was** — the reservation leg of `AvailabilityRepository` was correctly date-bounded, but the occupancy leg beside it was `WHERE deleted_at IS NULL AND status = 'CHECKED_IN'` with no dates. `occupancy` carries no dates of its own; it hangs off a reservation.
- **Effect** — a unit occupied *tonight* read as unavailable for **every** future range. Harmless for today's walk-in (the guest really is in the room), useless for "what is free next month" — which is exactly what the booking calendar and the walk-in search ask. Found while planning G32's calendar.
- **Fixed** — the occupancy leg is now gated to a range that includes today (`availability.repository.ts:88-89`, `:133-134`, `:174`), and the whole-row EXISTS variant is narrowed to today's column only. The guest's *scheduled* nights are already covered by the reservation leg now that CHECKED_IN sits in its whitelist; what the occupancy leg adds is the **overstay**, and an overstay is only knowable as of today — which is why it is scoped to today rather than dropped outright.
- **Guarded by** — `availability-d06.test.ts`.
- ⚠️ **Bookkeeping note (2026-09-08 audit)** — this was fixed on 2026-09-07 but stayed marked `OPEN` here until the audit caught it. It is the only item that was wrong in this direction. Close the register entry in the same PR as the fix, not after.

### D07 · Maintenance has no date-ranged block · `OPEN` · Decide · M
- **Today** — `rooms.status` MAINTENANCE / OUT_OF_SERVICE is a *now* flag, and `maintenance_work_orders` has no scheduled window. There is no way to say "this unit is out from the 12th to the 15th".
- **Effect** — the calendar can only draw repairs as a whole-row wash with no end date, and forward availability cannot see a planned outage at all. Drawing a bar with invented dates would be a lie on the screen staff are meant to trust.
- **Needed** — a `room_blocks` table (room, date range, reason, `[)` like every other range here). Neighbours G20/G21; decide with them.

### D08 · Cash-basis revenue buckets months in UTC, not Gaborone · ✅ `RESOLVED` 2026-09-08
- **Was** — `reports.repository.ts` bucketed on `AT TIME ZONE 'UTC'`. The timezone of record is `Africa/Gaborone` (invariant 2), so a payment taken at 01:00 Gaborone on 1 October landed in **September**. Two hours of every month were in the wrong one.
- **Fixed** — all 16 month labels and window comparisons now use `Africa/Gaborone`, applied to *both* the label and the filter so a row cannot be labelled with one month and filtered by another. Fixed across revenue, VAT, maintenance and owner statements together: half of a P&L on one clock and half on another is worse than either.
- ⚠️ **Announced, not slid in** — this MOVES historical cash figures. Only late-night payments change month (22:00–00:00 Gaborone), so the shift is small and lands entirely on month boundaries; it was zero on the demo data. Verified on the boundary itself: `2026-09-30 22:30Z` now buckets to October, `21:30Z` stays in September, and an ordinary daytime payment does not move.
- **Why it was fixed here rather than alone** — the earned-vs-received view compares accrual months (correct by construction) against cash months. Reconciling one correct column against one two-hours-wrong column is not a reconciliation.
- **Guarded by** — `reports-accrual.test.ts`, against real Postgres. Reverting the timezone puts both boundary payments in September and fails the test.
- *The accrual ledger was never affected: `stay_date` is a `DATE`, and a calendar night has no timezone ambiguity.*

### D09 · Invoice numbers are random, and stamped with the wrong year at midnight · ✅ `RESOLVED` 2026-09-08
- **Was** — `invoiceNumber()` returned `INV-<year>-<8 hex>`. Two effects: (1) numbers had no sequence, so "is a document missing?" was unanswerable, for the owner and for BURS; (2) the year came from raw `new Date().getFullYear()`, which broke invariant 2 — an invoice raised at 01:00 Gaborone on 1 January was numbered for the *previous* year, into a series already reported.
- **Fixed** — `document_number_series` (migration 068), a per-prefix-per-year counter, allocated by `core/documents/numbering.ts` **inside the transaction that inserts the document**. Format `INV-2026-000001`. The year comes from the Gaborone property day.
- **Why a counter table and not a Postgres SEQUENCE** — a sequence is explicitly not gapless: `nextval()` is non-transactional, so a rolled-back insert burns its number for ever, which is the exact hole this closes. The counter is ordinary transactional data, so number and document commit together or not at all. Concurrent callers serialise on the row lock; a single upsert leaves no read-then-write race.
- **Accepted, documented** — the counter is **not** seeded past the invoices that already exist. Those carry random numbers, have been emailed to guests and cannot be renumbered, so the honest record is a legacy stretch followed by a sequence that starts at 1. Starting above the legacy count would imply those rows were 1..n of this series, which is the one thing a gapless series must never claim. The two formats cannot collide (8 hex characters vs 6 zero-padded digits — different lengths), which is what keeps `invoices.number` UNIQUE satisfiable.
- **Guarded by** — `invoice-numbering.test.ts`, against real Postgres: every claim here is a claim about the database. It asserts the rollback leaves no gap, that ten concurrent callers get a contiguous 1..10 with no duplicates, and that 22:30 UTC on 31 December is stamped with the *new* year.
- **Follow-on, still open** — nothing in the app hard-deletes an invoice, but nothing stops it either. Void-instead-of-delete on posted documents remains G30 scope; until it lands, the series' gaplessness rests on convention rather than on a constraint.

### D05 · The e2e suite cannot run twice against one database · ✅ `RESOLVED` 2026-09-01 (PR #101)
- **Was** — `afterAll` closed the pool and deleted nothing, so the ACTIVE STANDARD rate plan it created 500'd the next run's first write.
- **Fixed** — teardown in FK order, deleting by `room_id` rather than by captured ids (a run that fails early never assigns them). The property and building are resolved from the seed, so they are left alone. Verified by three consecutive runs against one database: 12/12 each, no warnings, tables left empty.

---

## 32 gaps, ~20 jobs

Several entries are one capability drawn twice on the board.

- **G19 + G22** — one job: the monthly rent run.
- **G25 + G26** — one job: the reminder exists, only the renew action is missing.
- **G27 + G28** — resolve together with DPO, apart from the standalone discount fix.
- **G04, G06, G07, G14** — a single decision about whether campaigns run through this app at all.
- **G22 + G26** — share the lease-record foundation; build it once.

## Decisions to put to the client

1. **Do campaigns run through this app, or through tools that already do it well?** Settles G04, G06, G07, G14; G05 and G09 lean on the answer.
2. ~~**How far does the app go into accounting, given QuickBooks is in use?**~~ ✅ **Answered 2026-09-07: LSP is the book of record for revenue.** G30 moves from Decide to Build; G31 (banking) is now a real follow-on rather than a maybe. Period close and credit notes deferred, gapless numbering (D09) pulled forward.
3. **When does Little Hotelier actually get switched off?** Settles G32, dates G08.
4. **How many units are on monthly leases right now?** Decides whether the whole long-term block (G19, G22–G26) is urgent or merely untidy.
5. ~~**Should an unpaid booking hold the room?**~~ ✅ **Answered 2026-09-01: yes.** D01 closed in PR #99. Follow-on ~~**does an unpaid night count as occupancy in a report?**~~ ✅ **Answered 2026-09-07: yes, in the forward view only.** D02 closed.
6. ~~**Must a guest pay before the stay is confirmed?**~~ ✅ **Answered 2026-09-07: no.** Some clients settle after the stay. CONFIRMED now means *the stay is on*; money moved to its own axis (the folio). Recorded as an amended invariant 3 in `CLAUDE.md`.
