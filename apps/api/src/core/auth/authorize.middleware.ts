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

/** Pass when the user holds AT LEAST ONE of the listed permissions (authorize = all). */
export function authorizeAny(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthorized());
      return;
    }
    const granted = req.user.permissions;
    if (!permissions.some((p) => granted.includes(p))) {
      next(AppError.forbidden(`Required one of: ${permissions.join(', ')}`));
      return;
    }
    next();
  };
}
