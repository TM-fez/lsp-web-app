import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { requestId } from './core/middleware/requestId.middleware.js';
import { errorHandler } from './core/errors/errorHandler.middleware.js';
import { healthRouter } from './modules/health/health.routes.js';
import { router } from './router.js';

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));

// ── Global rate limit ─────────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Request parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Request ID ────────────────────────────────────────────────────────────────
app.use(requestId);

// ── Health — mounted at root, no auth, accessible to infra probes ─────────────
app.use('/health', healthRouter);

// ── Versioned API ─────────────────────────────────────────────────────────────
app.use(env.API_PREFIX, router);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ statusCode: 404, error: 'Not Found', message: 'Route not found' });
});

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`[api] listening  → http://localhost:${env.PORT}`);
  console.log(`[api] health     → http://localhost:${env.PORT}/health`);
  console.log(`[api] api prefix → http://localhost:${env.PORT}${env.API_PREFIX}`);
});

export { app, server };
