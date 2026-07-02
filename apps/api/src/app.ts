import 'dotenv/config';
import * as Sentry from '@sentry/node';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { requestId } from './core/middleware/requestId.middleware.js';
import { requestLog } from './core/middleware/requestLog.middleware.js';
import { errorHandler } from './core/errors/errorHandler.middleware.js';
import { healthRouter } from './modules/health/health.routes.js';
import { router } from './router.js';

// The configured Express app, with NO `listen()` — so it can be imported both by the
// long-running server (server.ts) and by a serverless handler (api/index.ts) without
// binding a port. Starting the HTTP listener + the background scheduler lives in server.ts.
// ── Sentry (errors only) — DARK until SENTRY_DSN is set ───────────────────────
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Deliberately no tracesSampleRate: error capture only, free-tier friendly.
  });
}

const app = express();

// ── Proxy awareness ───────────────────────────────────────────────────────────
// Behind Vercel→Render every request arrives from the proxy's socket; without this,
// req.ip is the proxy for ALL users, so every per-IP rate limit is shared globally
// and audit logs record the proxy address. A fixed hop count (never `true`) means we
// only trust the X-Forwarded-For entries our own infrastructure appended — a caller
// hitting the Render URL directly can spoof at most the entries beyond that count.
if (env.TRUST_PROXY_HOPS > 0) {
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
}

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

// ── Request logging — one structured line per request, sharing the request id.
// Off under tests: suites deliberately exercise 4xx paths and would drown the output.
if (env.NODE_ENV !== 'test') {
  app.use(requestLog);
}

// ── Health — mounted at root, no auth, accessible to infra probes ─────────────
app.use('/health', healthRouter);

// ── Versioned API ─────────────────────────────────────────────────────────────
app.use(env.API_PREFIX, router);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ statusCode: 404, error: 'Not Found', message: 'Route not found' });
});

// ── Error handlers (must be last; Sentry captures BEFORE ours responds) ───────
if (env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app, {
    // Expected 4xx AppErrors are responses, not incidents — only report real bugs.
    shouldHandleError: (error) => {
      const status = (error as { statusCode?: number }).statusCode;
      return status === undefined || status >= 500;
    },
  });
}
app.use(errorHandler);

export { app };
export default app;
