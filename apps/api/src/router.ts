import { Router } from 'express';
import { authRouter }      from './modules/auth/auth.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';

const router = Router();

// ── Sprint 1 — Authentication ─────────────────────────────────────────────────
router.use('/auth',      authRouter);

// ── Sprint 1 — Dashboard ──────────────────────────────────────────────────────
router.use('/dashboard', dashboardRouter);

// ── Sprint 1 — CRM (next) ─────────────────────────────────────────────────────
// router.use('/contacts',  contactsRouter);

// ── Sprint 1 — Supporting modules ────────────────────────────────────────────
// router.use('/users',     usersRouter);
// router.use('/files',     filesRouter);
// router.use('/flags',     flagsRouter);

export { router };
