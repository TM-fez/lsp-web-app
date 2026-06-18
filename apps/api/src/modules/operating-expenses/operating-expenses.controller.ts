import type { Request, Response, NextFunction } from 'express';
import { OperatingExpensesService } from './operating-expenses.service.js';
import { OperatingExpenseCategoryEnum } from './operating-expenses.types.js';
import type {
  CreateOperatingExpenseDTO,
  UpdateOperatingExpenseDTO,
} from './operating-expenses.types.js';

export class OperatingExpensesController {
  constructor(private readonly service: OperatingExpensesService) {}

  private meta(req: Request) {
    return { userId: req.user!.sub, ip: req.ip, requestId: req.id };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const category = req.query.category
        ? OperatingExpenseCategoryEnum.parse(req.query.category)
        : undefined;
      res.json({
        data: await this.service.list({
          property_id: (req.query.property_id as string) || undefined,
          category,
          from: (req.query.from as string) || undefined,
          to: (req.query.to as string) || undefined,
        }),
      });
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.get(req.params.id as string));
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateOperatingExpenseDTO;
      res.status(201).json(await this.service.create(dto, this.meta(req)));
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpdateOperatingExpenseDTO;
      res.json(await this.service.update(req.params.id as string, dto, this.meta(req)));
    } catch (err) {
      next(err);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.service.remove(req.params.id as string, this.meta(req));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  };
}
