import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { loginSchema, changePasswordSchema } from './auth.schema.js';
import { createLoginLimiters } from './auth.limiters.js';
import * as authController from './auth.controller.js';

const router = Router();

// Login gates (failed attempts only, keyed by IP+email — see auth.limiters.ts).
const loginLimiters = createLoginLimiters();

// (P7) Change-password checks the current password, so it is a guessing oracle for anyone
// holding a stolen access token. Cap it per ACCOUNT (it runs after authenticate, so the
// user is known) — its own budget, so a typo-prone owner doesn't lock themselves out of login.
const changePasswordLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub ?? req.ip ?? 'unknown',
  message: { statusCode: 429, error: 'Too Many Requests', message: 'Too many attempts — wait a few minutes and try again.' },
});

// Refresh is cookie-driven and cheap, but unlimited it invites token-guessing and DB
// hammering. Generous ceiling — a real client refreshes ~4×/hour per tab.
const refreshLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_REFRESH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { statusCode: 429, error: 'Too Many Requests', message: 'Too many refresh attempts' },
});

// ── Public endpoints ───────────────────────────────────────────────────────────
router.post('/login',   ...loginLimiters, validateBody(loginSchema), authController.login);
router.post('/refresh', refreshLimiter,                    authController.refresh);
router.post('/logout',                                     authController.logout);

// ── Authenticated endpoints ────────────────────────────────────────────────────
router.get ('/me',          authenticate, authController.me);
router.post('/logout-all',  authenticate, authController.logoutAll);
// (P7) Same brute-force ceiling as login: it, too, is a password guess.
router.post('/change-password', authenticate, changePasswordLimiter, validateBody(changePasswordSchema), authController.changePassword);

export { router as authRouter };
