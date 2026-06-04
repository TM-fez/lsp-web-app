import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';

export function authorize(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }
    const granted = req.user.permissions;
    const hasAll = permissions.every((p) => granted.includes(p));
    if (!hasAll) {
      next(AppError.forbidden(`Required: ${permissions.join(', ')}`));
      return;
    }
    next();
  };
}
