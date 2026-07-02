import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

/**
 * One structured log line per completed request, tagged with the same request id the
 * requestId middleware issued (so a log line ↔ audit row ↔ error report all join up).
 * Hand-rolled instead of pino-http: that package globally re-types `req.id` as
 * string|number and broke every controller — for one log line per request, a
 * dependency here is all surface area and no payoff.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  // Health probes every few seconds would drown everything else.
  if (req.path === '/health' || req.path.startsWith('/health/')) return next();

  const startMs = Date.now();

  res.on('finish', () => {
    const fields = {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
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
