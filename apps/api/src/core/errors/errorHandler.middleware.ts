import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from './AppError.js';
import { env } from '../../config/env.js';
import { logger } from '../logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = res.locals['requestId'] as string | undefined;

  // (H6) Bad input is the caller's mistake, not a crash. These used to fall through to
  // the 500 branch, which outside production echoed raw Postgres text ("invalid input
  // syntax for type uuid: …") back to the browser. Map them to a plain 400 first.
  const badInput = badInputMessage(err);
  if (badInput) {
    res.status(400).json({ statusCode: 400, error: 'Bad Request', message: badInput, requestId });
    return;
  }

  // Expected errors (AppError/Zod) are the response, not an incident. Anything else
  // is a bug — log it with full context, because the client only gets a generic 500.
  if (!(err instanceof AppError) && !(err instanceof ZodError)) {
    logger.error({ requestId, err, method: req.method, url: req.originalUrl }, 'unhandled error');
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      statusCode: err.statusCode,
      error: err.error,
      message: err.message,
      requestId,
    });
    return;
  }

  // Zod validation errors not caught by validateBody (e.g. query-param parsing)
  if (err instanceof ZodError) {
    res.status(400).json({
      statusCode: 400,
      error: 'Bad Request',
      message: err.errors.map((e) => e.message).join('; '),
      requestId,
    });
    return;
  }

  const message = env.NODE_ENV === 'production' ? 'Internal Server Error' : String(err);

  res.status(500).json({
    statusCode: 500,
    error: 'Internal Server Error',
    message,
    requestId,
  });
}

/**
 * A user-facing message when `err` is malformed input rather than a bug, else null.
 * - body-parser's JSON syntax error (`type: 'entity.parse.failed'`)
 * - Postgres 22P02 (a value that isn't a valid uuid / number / enum, e.g. `/invoices/abc`)
 * - Postgres 22007 / 22008 (an impossible date)
 */
function badInputMessage(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { type?: string; code?: string };
  if (e.type === 'entity.parse.failed') return 'The request body isn’t valid JSON.';
  if (e.code === '22P02') return 'One of the values sent isn’t in the right format — check any ids, numbers or options.';
  if (e.code === '22007' || e.code === '22008') return 'One of the dates sent isn’t a real date.';
  return null;
}
