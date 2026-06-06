import type { Request, Response, NextFunction } from 'express';
import { PricingService } from './pricing.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { UnitTypeEnum } from './pricing.types.js';
import { nightsBetween } from '../quotes/quotes.util.js';
import type { CreateRatePlanDTO, UpdateRatePlanDTO } from './pricing.types.js';

export class PricingController {
  constructor(private readonly service: PricingService) {}

  private getRequestMeta(req: Request) {
    return { userId: req.user!.sub, ip: req.ip, requestId: req.id };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
      const unit_type = req.query.unit_type ? UnitTypeEnum.parse(req.query.unit_type) : undefined;
      const active = req.query.active === undefined ? undefined : req.query.active === 'true';
      const result = await this.service.listRatePlans({ unit_type, active }, { page, limit });
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getRatePlan(req.params.id as string));
    } catch (err) {
      next(err);
    }
  };

  // Team-informed pricing preview — shows the breakdown without creating a quote.
  preview = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const unitType = UnitTypeEnum.parse(req.query.unit_type);
      let nights = parseInt(req.query.nights as string);
      if (!nights && req.query.check_in && req.query.check_out) {
        nights = nightsBetween(new Date(req.query.check_in as string), new Date(req.query.check_out as string));
      }
      if (!nights || nights < 1) throw AppError.badRequest('Provide nights, or check_in & check_out');
      res.json(await this.service.previewPrice(unitType, nights));
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateRatePlanDTO;
      res.status(201).json(await this.service.createRatePlan(dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpdateRatePlanDTO;
      res.json(await this.service.updateRatePlan(req.params.id as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.service.deleteRatePlan(req.params.id as string, this.getRequestMeta(req));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
