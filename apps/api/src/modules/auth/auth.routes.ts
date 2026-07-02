import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { validateBody } from '../../core/middleware/validate.middleware.js';
import { authenticate } from '../../core/auth/authenticate.middleware.js';
import { loginSchema } from './auth.schema.js';
import * as authController from './auth.controller.js';

const router = Router();

// Stricter rate limit applied only to the login endpoint
const loginLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { statusCode: 429, error: 'Too Many Requests', message: 'Too many login attempts' },
});

// Second login gate keyed by the TARGET ACCOUNT, not the caller: caps brute force on
// one email across many IPs (incl. anyone spoofing X-Forwarded-For at the Render URL
// directly, past the TRUST_PROXY_HOPS boundary). Falls back to IP when no email.
const loginAccountLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    (typeof req.body?.email === 'string' && req.body.email.trim().toLowerCase()) || req.ip || 'unknown',
  message: { statusCode: 429, error: 'Too Many Requests', message: 'Too many login attempts' },
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
router.post('/login',   loginLimiter, loginAccountLimiter, validateBody(loginSchema), authController.login);
router.post('/refresh', refreshLimiter,                    authController.refresh);
router.post('/logout',                                     authController.logout);

// ── Authenticated endpoints ────────────────────────────────────────────────────
router.get ('/me',          authenticate, authController.me);
router.post('/logout-all',  authenticate, authController.logoutAll);

export { router as authRouter };
