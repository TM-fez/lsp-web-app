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

  // body-parser's own refusals carry the right status (413 too large, 415 bad charset…).
  // They used to fall through to the 500 branch below.
  const parserStatus = bodyParserStatus(err);
  if (parserStatus) {
    const tooLarge = parserStatus === 413;
    res.status(parserStatus).json({
      statusCode: parserStatus,
      error: tooLarge ? 'Payload Too Large' : 'Bad Request',
      message: tooLarge ? 'That request is too large — files can be up to 10 MB.' : 'The request body couldn’t be read.',
      requestId,
    });
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
 * - (Re-test 2026-10-04) the rest of the ways a typed value reaches Postgres malformed,
 *   which still came back as a 500 with raw database text:
 *   2201W / 2201X — a negative `limit` / `offset` (`?limit=-5`, on lists whose controller
 *     parses it by hand); 22003 — a number too big for its column; 22021 — a NUL byte or
 *     bad encoding in a search box; 22001 — text longer than its column;
 *   23503 — a reference to something that doesn't exist (e.g. filing a document under a
 *     property id nobody has). Every write that can hit one of these is the caller's bad
 *     input, never a half-done change: each runs in a transaction that rolls back.
 */
function badInputMessage(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { type?: string; code?: string; detail?: string };
  if (e.type === 'entity.parse.failed') return 'The request body isn’t valid JSON.';
  if (e.code === '22P02') return 'One of the values sent isn’t in the right format — check any ids, numbers or options.';
  if (e.code === '22007' || e.code === '22008') return 'One of the dates sent isn’t a real date.';
  if (e.code === '2201W' || e.code === '2201X') return 'Page and page size must be positive numbers.';
  if (e.code === '22003') return 'One of the numbers sent is too large.';
  if (e.code === '22021') return 'One of the values sent contains characters that can’t be stored.';
  if (e.code === '22001') return 'One of the values sent is too long.';
  // Only the "points at nothing" half of 23503. "Still referenced" (deleting a row others
  // need) is a real conflict a module should explain itself — left to the 500 path.
  if (e.code === '23503' && /is not present in table/.test(e.detail ?? '')) {
    return 'Something this refers to doesn’t exist — check the selected item and try again.';
  }
  return null;
}

/**
 * The status of a body-parser refusal (it sets `type` and a 4xx `status`) or a multer
 * upload refusal (`name: 'MulterError'`: over the size limit → 413, else 400), else null.
 */
function bodyParserStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { type?: unknown; status?: unknown; name?: unknown; code?: unknown };
  if (e.name === 'MulterError') return e.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  if (typeof e.type !== 'string' || typeof e.status !== 'number') return null;
  return e.status >= 400 && e.status < 500 ? e.status : null;
}
