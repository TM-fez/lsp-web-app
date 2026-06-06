import type { Request, Response, NextFunction } from 'express';
import { QuotesService } from './quotes.service.js';
import { QuoteStatusEnum } from './quotes.types.js';
import { UnitTypeEnum } from '../pricing/pricing.types.js';
import type { CreateQuoteDTO } from './quotes.types.js';

export class QuotesController {
  constructor(private readonly service: QuotesService) {}

  private getRequestMeta(req: Request) {
    return {
      userId: req.user!.sub,
      ip: req.ip,
      requestId: req.id,
      canOverride: (req.user?.permissions ?? []).includes('pricing.override'),
    };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
      const status = req.query.status ? QuoteStatusEnum.parse(req.query.status) : undefined;
      const unit_type = req.query.unit_type ? UnitTypeEnum.parse(req.query.unit_type) : undefined;
      res.json(await this.service.listQuotes({ status, unit_type }, { page, limit }));
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getQuote(req.params.id as string));
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateQuoteDTO;
      res.status(201).json(await this.service.createQuote(dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };
}
