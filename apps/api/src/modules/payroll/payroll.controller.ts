import type { Request, Response, NextFunction } from 'express';
import { PayrollService } from './payroll.service.js';
import type { UpsertCompensationDTO, PostPayrollDTO } from './payroll.types.js';

export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  private meta(req: Request) {
    return { userId: req.user!.sub, ip: req.ip, requestId: req.id };
  }

  listEmployees = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ data: await this.service.listEmployees() });
    } catch (err) {
      next(err);
    }
  };

  summary = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.summary());
    } catch (err) {
      next(err);
    }
  };

  upsert = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpsertCompensationDTO;
      res.json(await this.service.upsertCompensation(req.params.userId as string, dto, this.meta(req)));
    } catch (err) {
      next(err);
    }
  };

  postToOpex = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as PostPayrollDTO;
      res.status(201).json(await this.service.postToOperatingCosts(dto.month, this.meta(req)));
    } catch (err) {
      next(err);
    }
  };
}
