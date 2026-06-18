import type { Request, Response, NextFunction } from 'express';
import { ReportsService } from './reports.service.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  // GET /reports/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD&property_id=…
  pnl = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const from = typeof req.query.from === 'string' && DATE.test(req.query.from) ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' && DATE.test(req.query.to) ? req.query.to : undefined;
      const propertyId = (req.query.property_id as string) || undefined;
      res.json(await this.service.getReports({ from, to, propertyId }));
    } catch (err) {
      next(err);
    }
  };
}
