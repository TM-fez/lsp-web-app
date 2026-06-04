import type { Request, Response, NextFunction } from 'express';
import { AppError } from './AppError.js';
import { env } from '../../config/env.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = res.locals['requestId'] as string | undefined;

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      statusCode: err.statusCode,
      error: err.error,
      message: err.message,
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
