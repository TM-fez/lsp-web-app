# Lifestyle Platform — Phase 2 Plan & Timeline

**Prepared for:** Fahad
**About:** The next stage of development for the Lifestyle operations platform (the system that runs reservations, the cockpit, housekeeping, maintenance, accounts and the public booking page).

---

## 1. The short version

We have agreed on a set of new features. This document explains, in plain language:

- what each feature is and why it helps the business,
- the order we will build them in, and
- how long each stage will take.

We will build in **stages (phases)**. After each phase you will be able to see and use the new work on the live system before we move on. Nothing is hidden until the end.

**Total time for the full plan: about 3 to 3.5 months of focused work.** A few items wait on decisions or paperwork from your side — those run alongside the main work and slot in when they are ready.

---

## 2. Where we are today

The platform is already live and running the real business: 25 real apartments across the Village blocks, with reservations, the operations cockpit, housekeeping, maintenance, pricing, accounts, payroll, and the public booking page (`/stay`) all working. The budget for this next stage is approved.

This Phase 2 is the **expansion plan**: one single platform that can run several properties at once (the centralized approach we discussed — not copying the whole system for each property), plus a set of upgrades to maintenance, housekeeping, reservations, dashboards, and marketing.

---

## 3. How we will work

- We build **one phase at a time**, in a deliberate order.
- Each new feature is added carefully and reviewed before it goes live, so the system that is running the business today stays stable.
- Some features depend on others (for example, the "many properties" foundation must be in place before everything else can be split per property). The order below respects those links so we do not build things twice.
- Items that need your decision or outside paperwork (like card payments) do **not** hold up the rest of the work — they run on a side track and join in when ready.

---

## 4. The phases

### Phase 0 — Tidy-up and quick wins
**Time: about 1 week**

Small, safe improvements that clear the deck and add value immediately:
- Remove leftover test/demo data so the system is clean for daily use.
- Clearly mark which bookings came from the website (versus phone, walk-in, etc.).
- Add a **WhatsApp follow-up button**: staff tap it on their phone and it opens WhatsApp with the guest already loaded, ready to message. (Messages are sent from staff phones — no special WhatsApp business account needed.)
- Update internal setup notes.

**What you get:** a cleaner system, clearer booking sources, and faster guest follow-up — within the first week.

---

### Phase 1 — One platform, many properties *(the foundation)*
**Time: about 2 to 3 weeks**

This is the heart of the Village Phase 2 expansion and the most important piece. Everything else is built on top of it.

- **Log in once, then choose your property.** After signing in, staff who manage more than one property pick which one they want to work in. Staff who only belong to one property skip this step and go straight in — they never see the picker.
- **Each property is fully separate.** When you are inside a property, you only see that property's apartments, bookings, guests, and reports.
- **Per-property apartment names.** Each property can name its apartments however it likes, even if two properties use the same name — they will not clash.
- **Real security, not just hiding things.** The separation is enforced deep in the system, not just on the screen. A user simply cannot reach another property's data, even by trying. We will set up a proper list of which users are allowed into which properties.

**What you get:** a single platform that runs multiple properties side by side, with each property's data kept private and safe — ready for the Village expansion.

---

### Phase 2 — Behind-the-scenes engines
**Time: about 2 weeks**

Two pieces of "plumbing" that power several later features. You will not see big screens here, but they make Phases 3, 4 and 5 possible.

- **Notification system** — the ability for the app to show pop-up alerts and send reminders.
- **AI engine setup** — the connection to the AI that will later power marketing campaigns and dashboard insights.

**What you get:** the groundwork so the next features arrive faster and work reliably.

---

### Phase 3 — Maintenance and housekeeping upgrades
**Time: about 3 weeks**

**Maintenance**
- **Service-provider logins:** outside contractors get their own limited login to see and update only their own jobs — nothing else.
- **Pop-up alerts** for jobs that are pending or not yet assigned, so nothing is missed.
- **Automatic reminders** at set intervals for overdue or pending jobs.
- **Clear money trail:** each job is recorded against either a Lifestyle unit or a third-party landlord, so costs and responsibility are always clear.
- (Plus the WhatsApp button from Phase 0, used here too.)

**Housekeeping**
- **Three-step sign-off:** Routine Checks → Supervisor validation → Property Manager final sign-off. Every clean is checked and approved.
- **Built-in checklists** with turnaround time tracking, so standards and speed are both measured.
- **Tablet-friendly view:** floor staff use a tablet showing live room status and their task list.

**What you get:** tighter control and accountability over the two most hands-on parts of the operation.

---

### Phase 4 — Smarter bookings and dashboards
**Time: about 3 weeks**

**Reservations / CRM**
- New fields to record the **booking coordinator** (and whether the booking is corporate or individual) and a separate **billing/accounts contact**.
- **AI target marketing:** the system can group your premium customers and automatically draft marketing campaigns aimed at them.

**Dashboards**
- **Financial Cockpit:** a live view of money owed to you — outstanding balances and receivables.
- **Operational Cockpit:** occupancy percentage, plus month-by-month and year-by-year comparisons.
- **AI Strategy Engine:** ask the AI about the trends on your dashboard and have it suggest campaigns.

**What you get:** a clear financial and operational picture at a glance, plus AI help turning that picture into marketing action.

---

### Phase 5 — Turning OTA guests into direct guests
**Time: about 2 weeks**

A practical way to move Booking.com guests onto your own platform for their repeat stays:
- A **QR code in each apartment** that guests scan.
- Built-in **check-in and check-out questions**, and a **post-stay follow-up**.
- All of it feeds your customer list and the AI marketing from Phase 4.

**What you get:** fewer commission-paying repeat bookings and a growing list of direct, loyal guests.

---

## 5. Decisions we need from you

These do not block the main work, but the sooner they are settled the sooner the related feature can land:

1. **Online payments (card / mobile money).** To switch on real online payments, the merchant signup with the payment provider (DPO) needs to be finished and the test keys handed over. Until then, the booking page stays on pay-on-arrival. *(About 2 weeks of work once we have the keys — runs alongside the phases above.)*

2. **OTA guest details (Booking.com).** Booking.com calendars already sync automatically. The remaining question is guest contact details, which do not come through that sync. Two options:
   - **Manual:** staff copy guest details from the Booking.com Extranet. No build, available now. *(Recommended to start.)*
   - **Full automatic link:** a deeper connection to Booking.com. This needs separate approval, more time, and likely extra cost — it would not fit a short window.

3. **WhatsApp messages.** Please confirm you are happy with staff sending WhatsApp follow-ups from their own phones (via the button we add). If you ever want the *system itself* to send WhatsApp messages automatically, that is a separate, larger piece of work we can scope later.

4. **Hosting.** The current database is on a free plan that expires around **September 2026**. Before heavy daily use, we should move it to a paid plan so it is reliable and always on. This is a small cost and a quick switch — just needs a yes.

---

## 6. Timeline at a glance

| Phase | What | Time |
|------|------|------|
| 0 | Tidy-up and quick wins | ~1 week |
| 1 | One platform, many properties (foundation) | ~2–3 weeks |
| 2 | Behind-the-scenes engines | ~2 weeks |
| 3 | Maintenance and housekeeping upgrades | ~3 weeks |
| 4 | Smarter bookings and dashboards | ~3 weeks |
| 5 | Turning OTA guests into direct guests | ~2 weeks |
| — | **Core total** | **~13–14 weeks (≈ 3–3.5 months)** |
| Side track | Online payments (DPO) — when keys arrive | ~2 weeks |

*Times assume focused, uninterrupted development. They can shift slightly with feedback rounds, but the order stays the same.*

---

## 7. What happens next

With your go-ahead, we start with **Phase 0 (tidy-up)** and move straight into **Phase 1 (the many-properties foundation)** — the most important building block. You will see progress on the live system as each piece lands.

The three decisions in Section 5 can be made any time; the earlier they are settled, the smoother the related features arrive.
