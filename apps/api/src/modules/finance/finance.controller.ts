import type { Request, Response, NextFunction } from 'express';
import { FinanceService } from './finance.service.js';

export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  // GET /finance/receivables — real-time outstanding ledger for the ACTIVE property.
  // Scope comes from X-Property-Id via requireActiveProperty (which has already checked
  // the caller may enter it), exactly like GET /invoices. There is deliberately no
  // ?property_id override: a second way to pick the scope is how the two screens drifted.
  receivables = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getCockpit({ propertyId: req.activePropertyId! }));
    } catch (err) {
      next(err);
    }
  };

  // GET /finance/cancelled-with-money — cancelled bookings that still hold paid money.
  heldOnCancelled = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.heldOnCancelled({ propertyId: req.activePropertyId! }));
    } catch (err) {
      next(err);
    }
  };
}
