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
Last reviewed **2026-09-01** against `main` @ `35df771` (migrations to 066, PRs to #99). The G-items below are
unchanged from the 2026-08-24 audit except where marked; the defect section at the bottom is current.

---

## Start here

Small, unblocked, needs nobody's permission. Clearing these closes eight of the thirty-two.
(One is already struck through — G28's standalone half shipped on 2026-09-01.)

| Ref | Item | Why it's cheap |
|---|---|---|
| G15 | Direct vs OTA revenue | Source is already recorded on every booking |
| G13 | Conversion rate | Leads already carry source and outcome |
| G20 | Maintenance inspection | Copy the sign-off housekeeping already has |
| G23 | Payment proof | Settle endpoint already accepts a receipt file |
| G18 | Stay type | One field on the booking |
| ~~G28~~ | ~~Discount fix~~ | ✅ done, PR #94 — the charge now uses the discounted total |
| G12 | Stale lead alert | Reuse the existing reminder sweep |
| G21 | Post-checkout link | Tie a departure-day repair to the departing guest |

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

### G30 · Accounts Processing · `HALF` · Decide · L
- **Today** — expenses, operating costs, payroll, receipts and invoices all captured.
- **Needed** — the accountant's working layer: journal, period notes, close. The app was deliberately built as not-an-accounting-system and QuickBooks is in use. **Decide the boundary before building.**

### G31 · Banking · `OUT` · Build · L
- **Today** — no bank account, statement import or reconciliation. Reconciliation happens by hand every Monday.
- **Needed** — at minimum import a bank statement and match against invoices. The board's Cash/POS Reconciliation and Payment Verification arrows have no counterpart in the software.

### G32 · Little Hotelier · `OUT` · Decide · S
- **Today** — drawn on the board as a live step, now clearly out of date. The guest list is already migrated off (~1,300 contacts, stay counts preserved, migrations 061/062). The app still has no integration, by design.
- **Needed** — a date, not a build. The data rescue is done and as complete as it will ever be: the export carried no dates or amounts and the owner can no longer pull them. Decide when the subscription stops; take the box off the map.

---

## Found in the code, not on the board

### D01 · "Looked free, got 409" · ✅ `RESOLVED` 2026-09-01 (PR #99)
- **Was** — two definitions of "blocked" live at once. `checkAvailability` and the `reservations_no_overlap` constraint blocked on PENDING; the availability engine counted only `('CONFIRMED','BLOCKED')` + CHECKED_IN occupancy. A unit with a PENDING booking read as free in search, then 409'd on create — worst on public `/stay` bookings, which sit PENDING up to 24h.
- **Owner decision** — **an unpaid booking DOES hold the room.** All three now agree; the rule is recorded as invariant 7 in `CLAUDE.md` with the three places that must move together if it is ever reversed.
- **Consequence, deliberate** — `EXPORTABLE_STATUSES` gained PENDING, so a held night publishes to Booking.com as busy. Over-blocking loses a booking if the hold expires; under-blocking loses a guest's room. One constant to flip if the balance proves wrong in practice.
- **Guarded by** — `availability-d01.test.ts` asserts the *invariant* (search and booking never disagree), not the rule, so a reversal fails loudly rather than reopening the divergence elsewhere.

### D02 · Unpaid nights are not "demand" in forward occupancy · `OPEN` · Decide · S
- **Today** — `reports.forwardOccupancy` counts `('CONFIRMED','CHECKED_IN','BLOCKED')`. Since D01, a PENDING night is unsellable but still absent from the forward-occupancy nudge, so the nudge can say "you have space" about a room nobody can book.
- **Needed** — an owner answer, not a build. Whether an unpaid night is *occupancy in a report* is a different question from whether it is *sellable*, and changing it moves numbers the owner reads. Deliberately left alone in #99.

### D03 · The activity feed is not property-scoped · `OPEN` · Build · M
- **Today** — a Village user sees CBD activity. `/activity` is gated on `activity.read` (migration 066) so contractors are out, but there is no property filter.
- **Needed** — `audit_logs` carries no property column, unlike the money paths (H5), so scoping means tracing each entity back through its own room → building → property chain. Low harm inside one company; matters before any third party gets a login.

### D04 · `PARTIALLY_PAID` is a status nothing writes · `OPEN` · Decide · S
- **Today** — read by the finance queries, the UI badges and the status filter; written by nothing. A part payment produces a fully-PAID smaller invoice plus an ISSUED balance (#96) instead.
- **Needed** — leave it or remove it. Removing means rebuilding a Postgres enum type, which is real work for no functional gain today. It earns its place with monthly rent instalments (G22/G24).

### D05 · The e2e suite cannot run twice against one database · `OPEN` · Build · S
- **Today** — `tests/e2e/cockpit.e2e.test.ts` leaves an ACTIVE STANDARD rate plan behind, and `rate_plans_active_unit_type_unique` makes the next run 500. Verified both ways 2026-08-31.
- **Needed** — teardown for what it creates. Invisible in CI (fresh container per run); it only costs local developers.

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
2. **How far does the app go into accounting, given QuickBooks is in use?** Settles G30, shapes G31.
3. **When does Little Hotelier actually get switched off?** Settles G32, dates G08.
4. **How many units are on monthly leases right now?** Decides whether the whole long-term block (G19, G22–G26) is urgent or merely untidy.
5. ~~**Should an unpaid booking hold the room?**~~ ✅ **Answered 2026-09-01: yes.** D01 closed in PR #99. Follow-on still open: does an unpaid night count as *occupancy in a report* (**D02**)?
