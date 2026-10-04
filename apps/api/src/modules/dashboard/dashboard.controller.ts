import type { Request, Response, NextFunction } from 'express';
import * as dashboardService from './dashboard.service.js';
import { propertyScopeForUser } from '../../core/scope/propertyScope.js';

export async function stats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const scope = await propertyScopeForUser(req.user!.sub, req.user!.role);
    const data = await dashboardService.getStats({ userId: req.user!.sub, ids: scope.ids, allProperties: scope.allProperties });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}
