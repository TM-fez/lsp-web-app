import { Router } from 'express';
import { authRouter }      from './modules/auth/auth.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { createContactsRouter } from './modules/crm/contacts/contacts.routes.js';
import { createLeadsRouter } from './modules/crm/leads/leads.routes.js';
import { createReservationsRouter } from './modules/reservations/reservations.routes.js';
import { createRoomsRouter } from './modules/rooms/rooms.routes.js';
import { createCheckinsRouter } from './modules/checkins/checkins.routes.js';
import { createAvailabilityRouter } from './modules/availability/availability.routes.js';
import { createFilesRouter } from './modules/files/files.routes.js';
import { createMaintenanceRouter } from './modules/maintenance/maintenance.routes.js';
import { createPricingRouter } from './modules/pricing/pricing.routes.js';
import { createHousekeepingRouter } from './modules/housekeeping/housekeeping.routes.js';
import { createCockpitRouter } from './modules/cockpit/cockpit.routes.js';
import { createQuotesRouter } from './modules/quotes/quotes.routes.js';
import { createHoldsRouter } from './modules/holds/holds.routes.js';
import { createPaymentsRouter } from './modules/payments/payments.routes.js';
import { createInvoicesRouter } from './modules/invoices/invoices.routes.js';
import { createCronRouter } from './modules/cron/cron.routes.js';
import { createUsersRouter } from './modules/users/users.routes.js';

const router = Router();

// ── Sprint 1 — Authentication ─────────────────────────────────────────────────
router.use('/auth',      authRouter);

// ── Sprint 1 — Dashboard ──────────────────────────────────────────────────────
router.use('/dashboard', dashboardRouter);

// ── Sprint 1 — CRM (next) ─────────────────────────────────────────────────────
router.use('/contacts',  createContactsRouter());
router.use('/leads',     createLeadsRouter());

// ── Sprint 2 — Reservations ───────────────────────────────────────────────────
router.use('/reservations', createReservationsRouter());

// ── Sprint 3 — Rooms ──────────────────────────────────────────────────────────
router.use('/rooms', createRoomsRouter());

// ── Sprint 4 — Check-In / Check-Out ───────────────────────────────────────────
router.use('/checkins', createCheckinsRouter());

// ── Sprint 5 — Availability ───────────────────────────────────────────────────
router.use('/availability', createAvailabilityRouter());

// ── Sprint 6 — Files ──────────────────────────────────────────────────────────
router.use('/files', createFilesRouter());

// ── Sprint 7 — Maintenance ────────────────────────────────────────────────────
router.use('/maintenance', createMaintenanceRouter());

// ── Sprint 8 — Commercial Core (Availability → Quote → Hold → Payment → Confirm)
router.use('/pricing',  createPricingRouter());
router.use('/quotes',   createQuotesRouter());
router.use('/holds',    createHoldsRouter());
router.use('/payments', createPaymentsRouter());
router.use('/invoices', createInvoicesRouter());

// ── Sprint 9 — Operations Cockpit: housekeeping turn workflow ─────────────────
router.use('/housekeeping', createHousekeepingRouter());
router.use('/cockpit',      createCockpitRouter());

// ── Scheduled jobs — platform cron hits this (secret-guarded), not RBAC ───────
router.use('/cron',         createCronRouter());

// ── Users & Roles — staff login management (admin-only via users.* perms) ─────
router.use('/users',        createUsersRouter());

// router.use('/flags',     flagsRouter);

export { router };
