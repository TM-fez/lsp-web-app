import type { ErrorEvent } from '@sentry/node';
import { redactUrl } from './middleware/requestLog.middleware.js';

/**
 * (Audit 2026-10-11, needs-checking #3 — confirmed) What a Sentry report may carry about the
 * request that crashed.
 *
 * Checked on a local copy with Sentry switched on as app.ts configures it: a crash during
 * POST /auth/login sent the typed email AND PASSWORD (request body), the refresh-token cookie
 * and the access token (headers) to Sentry. Sentry's default request capture keeps those
 * whatever `sendDefaultPii` says. A crash anywhere else would carry guest names, phones and
 * emails the same way.
 *
 * A report keeps what helps find the bug — method, path, status, stack — and drops the
 * rest: the body, every cookie, the Authorization header, and secrets in the URL (masked
 * the same way as the request log, see redactUrl).
 */
const DROP_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'idempotency-key']);

export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  const req = event.request;
  if (req) {
    delete req.data;
    delete req.cookies;
    if (req.headers) {
      for (const name of Object.keys(req.headers)) {
        if (DROP_HEADERS.has(name.toLowerCase())) delete req.headers[name];
      }
    }
    if (typeof req.url === 'string') {
      const u = req.url.match(/^(https?:\/\/[^/]+)(.*)$/);
      req.url = u ? `${u[1]}${redactUrl(u[2] ?? '')}` : redactUrl(req.url);
    }
    if (typeof req.query_string === 'string') {
      req.query_string = redactUrl(`?${req.query_string}`).slice(1);
    } else if (req.query_string) {
      delete req.query_string;
    }
  }
  // Never attach a user record (email / IP) to a report.
  delete event.user;
  return event;
}
