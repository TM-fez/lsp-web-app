# LSP — Go-Live Report

**Prepared for Fahad** · A plain-English walkthrough of everything left before launch, with each step explained: what it is, why it matters, who does it, and what it costs.

---

## The big picture

The app is **finished** — every feature is built, tested, and already running live on the web. Nothing below is "building." This report is a **switch-on and launch list**: connecting a few outside services and a couple of final housekeeping steps. **Paid hosting is already in place (2026-09-20).**

Throughout, two little markers show who does what:

- 👤 **Your call** — your account, your approval, or a decision only you can make.
- 🔧 **Technical** — we handle it once you give the go-ahead.

---

## First, how "switching on" actually works

Several features are built but deliberately **switched off until connected** — things like the AI, guest emails, and file storage. Each one needs an **access key** from an outside service (think of it as a password) entered **once** into our secure hosting dashboard. Two things worth knowing:

- **Keys are entered directly into the secure dashboard — never sent by email or chat.** They're like passwords; they go straight into the locked control panel, not into a message.
- **Until a key is entered, that feature stays safely off and nothing else is affected.** The app runs perfectly fine without them; you just don't get that one feature yet.

The moment a key is in place, the feature wakes up on its own. No new development needed.

---

## Part A — Paid hosting ✅ *(done 2026-09-20)*

**What it is:** the app runs on Render's **paid** tier for both the web service and the database (`starter` + `basic-256mb` in `render.yaml`).

**Background:** before 2026-09-20 we were on the free tier — the database was due to expire around **September 2026**, and the free server "fell asleep" when no one was using it (slow wake for guests and Booking.com's iCal fetch would time out). That was the only item with a real calendar deadline; it's closed now.

**Who / cost:**
- 👤 **Your call — ✅ done 2026-09-20.** You approved the monthly hosting fee; the service and Postgres moved to paid plans the same day.
- 🔧 **Technical** — we applied the upgrade in Render; the live API responds in about half a second with no cold start.

**Unlocks:** a server that's always awake, a database that won't expire, and the ability to turn on Booking.com sync (Part C).

---

## Part B — Switch on the smart features

These are the built-but-dormant features. Each just needs its access key entered into the dashboard. They're **independent** — we can do them in any order, one at a time. Here's the full picture, then each one in detail:

| # | Feature | Account needed | Cost | Where the key goes |
|---|---------|---------------|------|-------------------|
| 2 | AI marketing & strategy | Anthropic (Claude) | Pay-per-use, ~cents/month | Render (server) |
| 3 | Guest emails | Brevo | Free (~300 emails/day) | Render (server) |
| 4 | File storage + nightly backups | Cloudflare R2 | Free (10GB) | Render + GitHub |
| 5 | Error alerts + uptime | Sentry + UptimeRobot | Free | Render + Vercel |

### 2. AI marketing & strategy

**What it is:** the app's AI that writes marketing campaign messages for each guest group, and produces the "where to focus next quarter" strategy brief.

**Account:** Anthropic — the makers of Claude.

**Cost:** you only pay for what's used, and at this volume that's a **few cents a month**. It needs a card and a small prepaid credit to start.

**Who:** 👤 you open/approve the Anthropic account; 🔧 we enter the key into the server.

**Unlocks:** on the Marketing page, the "Generate campaign" and "AI strategy brief" buttons come alive — right now they show an "AI is switched off" note.

**Bonus:** we can test this privately before it goes live, so you actually see campaign copy generate first.

### 3. Guest emails

**What it is:** the app's automatic emails to guests.

**Account:** Brevo — an email delivery service.

**Cost:** the **free tier** covers around 300 emails a day, which is plenty.

**Who:** 👤 you create the Brevo account and verify a sending address (e.g. `bookings@yourdomain`); 🔧 we enter the key and sender address into the server.

**Unlocks:** booking confirmation emails, the "manage my booking" link for website guests, and the **automatic post-stay email** (thank-you + feedback request + book-direct offer) that goes out a day after checkout.

### 4. File storage + nightly backups

**What it is:** a proper cloud home for uploaded photos and documents, plus an automatic **nightly safety copy of the entire database**.

**Account:** Cloudflare R2 (recommended — 10GB free with no download charges).

**Cost:** **free** at your scale.

**Who:** 👤 you approve the account; 🔧 we create the storage, enter the keys, and switch storage over.

**Unlocks:** uploaded files stored reliably in the cloud (instead of on the server itself), and a database backup taken every night that we can restore from if anything ever goes wrong.

### 5. Error alerts + uptime monitoring

**What it is:** automatic warnings if something breaks, plus a monitor that checks the site is up.

**Accounts:** Sentry (error alerts) and UptimeRobot (uptime) — **both free**.

**Who:** 👤 you approve the free accounts; 🔧 we connect them to the server and website.

**Unlocks:** you get told promptly if a problem appears instead of hearing it from a guest.

---

## Part C — Turn on Booking.com sync *(only after Part A)*

**What it is:** two-way calendar sync between the app and your Booking.com listings, so bookings and blocks stay matched automatically.

**Why the order:** Booking.com's iCal fetch used to time out on the old free tier's sleeping server — that's fixed now that Part A is done (paid hosting, **2026-09-20**). Part C is ready whenever you are.

**Who / how:** 👤 for each apartment, you copy our sync link into your Booking.com extranet and copy Booking.com's link back into the app (there's a "Channel sync" box on each unit's screen for exactly this). 🔧 we then set two final keys and switch on the automatic 15-minute sync.

**Unlocks:** no more double-bookings across channels, and OTA bookings appearing in the app automatically — with a "Claim this booking" button to attach the guest's real details.

---

## Part D — Final launch steps *(do last, right before real guests)*

### 7. Clear out the demo data

**What it is:** the app currently holds **fake sample guests and bookings** we used for testing.

**Who:** 👤 you confirm the exact database and eyeball it first; 🔧 we then run the wipe.

**Important:** this is deliberate and **can't be undone**, which is why it's the last step and needs your sign-off before we fire it.

### 8. Housekeeping tidy-up

**What it is:** 🔧 we deactivate the empty "Main" building under CBD and clean up a couple of old leftover hosting projects. No impact on you or day-to-day use.

---

## Decisions we need from you *(not blockers, but pending)*

- **Card payments (DPO):** currently switched off on purpose — you paused this on 2 July. Do you want to **resume it** for launch or **leave it off**?
- **Booking.com guest details:** should staff **copy guest info manually** from the extranet (no build), or should we build the **full automated connection** (needs separate Booking.com approval)?
- **One small favour:** forward us a single real Booking.com "new booking" notification email — that lets us build automatic guest-detail capture later, against a real example rather than guesswork.

---

## Recommended order

1. **Part A** — paid hosting ✅ *(done 2026-09-20 — unblocks Booking.com)*
2. **Part B** — switch on the smart features, starting with the **AI (#2)** since it's a single key and the most visible win, then **guest emails (#3)**
3. **Part C** — Booking.com sync
4. **Part D** — wipe demo data, then **launch** 🎉

Parts B and the decisions can happen alongside everything else, in any order.

---

## What it costs to run

The reassuring part: **the main recurring cost is paid hosting (Part A) — live since 2026-09-20.** Everything in Part B is either free (Brevo, Cloudflare R2, Sentry, UptimeRobot) or a few cents of usage (the AI).
