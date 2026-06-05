import { Router } from 'express';
import { authRouter }      from './modules/auth/auth.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { createContactsRouter } from './modules/crm/contacts/contacts.routes.js';
import { createLeadsRouter } from './modules/crm/leads/leads.routes.js';
import { createReservationsRouter } from './modules/reservations/reservations.routes.js';

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
// router.use('/users',     usersRouter);
// router.use('/files',     filesRouter);
// router.use('/flags',     flagsRouter);

export { router };
