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
