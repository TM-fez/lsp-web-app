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

// ── Public endpoints ───────────────────────────────────────────────────────────
router.post('/login',   loginLimiter, validateBody(loginSchema), authController.login);
router.post('/refresh',                                           authController.refresh);
router.post('/logout',                                            authController.logout);

// ── Authenticated endpoints ────────────────────────────────────────────────────
router.get ('/me',          authenticate, authController.me);
router.post('/logout-all',  authenticate, authController.logoutAll);

export { router as authRouter };
