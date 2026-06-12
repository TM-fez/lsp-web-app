import type { Request, Response, NextFunction } from 'express';
import { ExpensesService } from './expenses.service.js';
import type { ExpenseStatus } from './expenses.types.js';

const STATUSES = ['PENDING', 'APPROVED', 'RECONCILED'] as const;

export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  private meta(req: Request) {
    return { userId: (req as any).user?.sub, ip: req.ip, requestId: (req as any).id };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.query.status as string | undefined;
      const status = raw && (STATUSES as readonly string[]).includes(raw) ? (raw as ExpenseStatus) : undefined;
      res.json({ data: await this.service.list(status) });
    } catch (err) {
      next(err);
    }
  };

  approve = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.approve(req.params.id as string, this.meta(req)));
    } catch (err) {
      next(err);
    }
  };

  reconcile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.reconcile(req.params.id as string, this.meta(req)));
    } catch (err) {
      next(err);
    }
  };
}
