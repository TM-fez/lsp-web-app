import type { Request, Response, NextFunction } from 'express';
import * as dashboardService from './dashboard.service.js';

export async function stats(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await dashboardService.getStats();
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
}
