import type { Request, Response, NextFunction } from 'express';
import { FinanceService } from './finance.service.js';
import { accessiblePropertyIdsForUser } from '../../core/scope/activeProperty.js';

export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  // GET /finance/receivables?property_id=… — real-time outstanding ledger.
  // Access scope: admins see every property; others only their own. A picked
  // property_id outside that set simply yields no rows.
  receivables = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const propertyId = (req.query.property_id as string) || undefined;
      const accessiblePropertyIds = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
      res.json(await this.service.getCockpit({ propertyId, accessiblePropertyIds }));
    } catch (err) {
      next(err);
    }
  };
}
