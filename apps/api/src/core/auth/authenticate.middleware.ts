import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { verifyAccessToken } from '../../modules/auth/auth.service.js';
import type { JwtPayload } from '@lsp/shared-types';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next(AppError.unauthorized('Authorization header missing or malformed'));
    return;
  }

  try {
    req.user = verifyAccessToken(authHeader.slice(7));
    next();
  } catch (err) {
    next(err);
  }
}
