import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

/**
 * One structured log line per completed request, tagged with the same request id the
 * requestId middleware issued (so a log line ↔ audit row ↔ error report all join up).
 * Hand-rolled instead of pino-http: that package globally re-types `req.id` as
 * string|number and broke every controller — for one log line per request, a
 * dependency here is all surface area and no payoff.
 */
/**
 * (Audit 2026-10-11, L-8) The full URL used to be logged, and some URLs carry secrets: a
 * guest's email and confirmation code (`/public/bookings/lookup?email=&code=`), a unit's QR
 * check-in token (`/public/checkin?token=`) and its Booking.com feed token
 * (`/ical/units/<token>`). Anyone with log access could replay them. Those values are masked;
 * the rest of the URL is kept so a log line still says what was asked.
 */
const SECRET_QUERY_KEYS = new Set(['email', 'code', 'token', 'phone']);
export function redactUrl(url: string): string {
  const [path = '', query] = url.split('?', 2);
  const safePath = path.replace(/(\/ical\/units\/)[^/?]+/i, '$1[redacted]');
  if (!query) return safePath;
  const safeQuery = query
    .split('&')
    .map((pair) => {
      const key = decodeURIComponent((pair.split('=', 1)[0] ?? '').replace(/\+/g, ' ')).toLowerCase();
      return SECRET_QUERY_KEYS.has(key) ? `${pair.split('=', 1)[0]}=[redacted]` : pair;
    })
    .join('&');
  return `${safePath}?${safeQuery}`;
}

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  // Health probes every few seconds would drown everything else.
  if (req.path === '/health' || req.path.startsWith('/health/')) return next();

  const startMs = Date.now();

  res.on('finish', () => {
    const fields = {
      requestId: req.id,
      method: req.method,
      url: redactUrl(req.originalUrl),
      status: res.statusCode,
      durationMs: Date.now() - startMs,
      ip: req.ip,
    };
    if (res.statusCode >= 500) logger.error(fields, 'request failed');
    else if (res.statusCode >= 400) logger.warn(fields, 'request rejected');
    else logger.info(fields, 'request completed');
  });

  next();
}
