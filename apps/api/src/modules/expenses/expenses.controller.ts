import type { Request, Response, NextFunction } from 'express';
import { ExpensesService } from './expenses.service.js';
import type { ExpenseStatus } from './expenses.types.js';
import { accessiblePropertyIdsForUser } from '../../core/scope/activeProperty.js';
import { AppError } from '../../core/errors/AppError.js';

const STATUSES = ['PENDING', 'APPROVED', 'RECONCILED'] as const;

export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  private meta(req: Request) {
    return { userId: (req as any).user?.sub, ip: req.ip, requestId: (req as any).id };
  }

  /** (H6) Sign-off only on spend in a property this user can access; else "not found". */
  private async requireAccessible(req: Request): Promise<void> {
    const ids = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
    if (ids === null) return;
    const pid = await this.service.propertyOf(req.params.id as string);
    if (!pid || !ids.includes(pid)) throw AppError.notFound('Expense not found');
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.query.status as string | undefined;
      const status = raw && (STATUSES as readonly string[]).includes(raw) ? (raw as ExpenseStatus) : undefined;
      // (H6) A management view across the properties this user can access — like the
      // reports and operating costs — not just the active one. It used to read every
      // property's repair costs, so a CBD-only user saw Village spend.
      const accessiblePropertyIds = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
      res.json({ data: await this.service.list(status, accessiblePropertyIds) });
    } catch (err) {
      next(err);
    }
  };

  approve = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.requireAccessible(req);
      res.json(await this.service.approve(req.params.id as string, this.meta(req)));
    } catch (err) {
      next(err);
    }
  };

  reconcile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.requireAccessible(req);
      res.json(await this.service.reconcile(req.params.id as string, this.meta(req)));
    } catch (err) {
      next(err);
    }
  };
}
