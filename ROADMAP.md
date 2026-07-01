# LSP Web App — Roadmap & Delivery Plan

Companion to `HANDOVER.md`. `HANDOVER.md` = how to run + where the project stands.
This file = the full backlog of what's left to build, plus the order to build it in.

Status legend: 🆕 not started · 🟡 partial (foundation exists) · 🔒 blocked on client · 🧹 cleanup/tech-debt · ✅ done

---

## Part 1 — Full backlog

### A1. Multi-property access / property picker  *(the keystone)*
- 🟡 Property → Building → Unit structure — exists (migration 040; Village + CBD seeded)
- 🟡 Property filter on cockpit/reservations — exists but **UI-only; server trusts the client**
- 🆕 `user_properties` permissions table (user → property mapping)
- 🆕 Server-side scoping enforced on **every** query (shared middleware + helper, rolled module-by-module)
- 🆕 Property picker as a post-login step (authority users) + auto-scope (single-property users, no picker)
- 🆕 Active-property carried server-side (JWT claim vs validated header — **decision pending**)
- 🆕 Per-property apartment naming (room `code` is globally unique today → scope uniqueness per building/property)

### A2. Maintenance
- 🟡 Module + contractor costs/expenses + completion/approval accountability — exists (024/037/038)
- 🆕 Scoped service-provider login (new contractor role; portal limited to their tickets)
- 🆕 In-app pop-up notifications (pending/unassigned) — **no notifications infra exists yet**
- 🆕 Automated interval reminders for overdue/pending (reuse cron pattern)
- 🆕 wa.me WhatsApp follow-up button (frontend deep link; staff sends from own phone)
- 🆕 L&P-unit vs third-party-landlord financial mapping (current accountability = who-did/who-approved, not owner attribution)

### A3. Housekeeping
- 🟡 Module — exists (032)
- 🆕 Three-stage flow: Routine Checks → Supervisor validation → Property Manager sign-off (status workflow + schema)
- 🆕 Compliance checklists with turnaround tracking (new tables)
- 🆕 Tablet view — live room status + tasks (responsive/PWA view, not a separate app)

### A4. Reservations / CRM
- 🆕 New fields: booking coordinator (corporate vs individual) + assigned billing/accounts contact
- 🆕 AI target marketing — segment premium customers, auto-generate group campaigns (LLM)
- 🔒 OTA guest details — Fahad decides: manual Extranet copy (no build) vs full Reservations API (separate approval)
- ✅ Booking.com via iCal — already solved

### A5. Dashboards
- 🟡 `reports` + `dashboard` modules — exist to build on
- 🆕 Financial Cockpit — real-time outstanding ledger balances + receivables
- 🆕 Operational Cockpit — occupancy %, monthly/annual comparative trends
- 🆕 AI Strategy Engine — prompt AI on dashboard trends → auto-generate campaigns (shares A4's LLM)

### A6. OTA-to-direct conversion
- 🟡 `/stay` public booking page + `checkins` module — exist
- 🆕 In-apartment QR code → check-in / checkout asks → post-stay follow-up
- 🆕 Feed captured guests into CRM + AI marketing (A4/A5)

### B. Pre-existing unfinished work
- 🔒🆕 **Phase B — real DPO Pay gateway** (replace simulated confirm; blocked on client sandbox keys). `settlePaid()` is the sole CONFIRM writer; `/stay` bookings have no hold → must generalise to confirm hold-less reservations.
- 🆕 Wire approved discount into the actual gateway charge (today only reduces displayed amount due)
- 🆕 `reservations.source = WEBSITE` column + surface origin (today only inferred via system user + note)
- 🆕 WhatsApp → Leads auto-capture; lead → reservation conversion; retention/reviews; lease-renewal workflow
- 🧹 Wipe leftover demo contacts / reservations / leads before pilot
- 🧹 Deactivate the now-empty "Main" building under CBD
- 🧹 Rewrite `DEPLOY.md` (predates the Vercel-web + Render-API split)
- 🧹🔒 Render free Postgres expires ~Sep 2026 → move to paid; free web service sleeps when idle
- 🧹 Clean up abandoned Vercel "-api" projects

### C. Cross-cutting dependencies (build once, used by many)
- 🆕 **Notifications infrastructure** — needed by A2, A3
- 🆕 **Claude/LLM integration** — shared by A4, A5, A6
- 🆕 **Multi-property scoping (A1)** — the keystone everything else scopes through

---

## Part 2 — Delivery plan (the order)

**Guiding principle:** build foundations before the features that depend on them, so scoping/
notifications/AI are inherited for free instead of retrofitted. Client-blocked items run on a
parallel track and slot in whenever the client unblocks them.

### Phase 0 — Quick wins (low risk, clears the deck)
Small, independent, no dependency on the keystone. Ships momentum.
- ✅ `reservations.source` column (enum + backfill) + surfaced in form/list/cockpit — migration 045
- ✅ wa.me WhatsApp button — built reusable (`WhatsAppButton` + `whatsapp.ts`), wired into the **guest** drawer.
  - ⏳ Follow-up: leads + maintenance have no phone to dial yet (leads UI doesn't surface the contact phone; maintenance has no contractor phone field). Add those phone fields, then drop the same button in.
- ✅ `DEPLOY.md` rewrite (Vercel-web + Render-API + Render-Postgres; in-process sweep)
- ⏸️ Parked: go-live data wipe (needs a deliberate DB target + owner eyeball before firing) + deactivate empty "Main" building

### Phase 1 — The keystone: multi-property scoping (A1)
Everything downstream gets scoped through this, so it goes first.
- `user_properties` table + active-property mechanism (decide JWT claim vs validated header)
- Shared scoping middleware/helper; roll out reservations → cockpit → every other module
- Property picker (authority) + auto-scope (single-property); per-property apartment naming

### Phase 2 — Shared infrastructure
Unblocks the operations + AI features that follow.
- ✅ Notifications infrastructure (in-app + interval reminders via cron) — per-recipient
  `notifications` table (052), `notifications` module with a reusable `notify()` emit helper
  (fan-out to a user / list / whole property), read-model API (list, unread-count, read,
  read-all), Topbar bell + dropdown, and a secret-guarded `GET /cron/reminders` sweep with
  idempotent generators (checkouts-due, stale high-priority repairs). Follow-up: narrow
  reminder targeting from "all property members" to the responsible department once Phase 3
  role mapping lands.
- ⏳ Claude/LLM integration scaffolding (one client, used by A4/A5/A6)

### Phase 3 — Operations depth (rides on Phase 1 + 2)
- Maintenance (A2): scoped contractor login, notifications, reminders, L&P-vs-landlord mapping
- Housekeeping (A3): three-stage flow, compliance checklists, tablet view

### Phase 4 — Revenue & intelligence (rides on Phase 1 + 2)
- Reservations/CRM new fields (A4)
- Dashboards: Financial + Operational Cockpit (A5)
- AI target marketing + AI Strategy Engine (A4/A5)

### Phase 5 — OTA-to-direct (rides on /stay + A4/A5)
- In-apartment QR → check-in/checkout asks → post-stay follow-up → CRM + AI marketing

### Parallel track — client-gated (slot in whenever unblocked)
- 🔒 Phase B DPO payments + discount-into-charge (when sandbox keys arrive)
- 🔒 OTA guest details (when Fahad decides manual vs Reservations API)
- 🔒 Render Postgres → paid (before real daily use; hard deadline ~Sep 2026)
