import type { Request, Response, NextFunction } from 'express';
import { HoldsService } from './holds.service.js';
import { HoldStatusEnum } from './holds.types.js';
import type { CreateHoldDTO, ReleaseHoldDTO } from './holds.types.js';

export class HoldsController {
  constructor(private readonly service: HoldsService) {}

  private getRequestMeta(req: Request) {
    return { userId: req.user!.sub, ip: req.ip, requestId: req.id };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
      const status = req.query.status ? HoldStatusEnum.parse(req.query.status) : undefined;
      const quote_id = req.query.quote_id as string | undefined;
      res.json(await this.service.listHolds({ status, quote_id }, { page, limit }));
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getHold(req.params.id as string));
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateHoldDTO;
      res.status(201).json(await this.service.createHold(dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  confirm = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.confirm(req.params.id as string, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  release = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = req.body as ReleaseHoldDTO;
      res.json(await this.service.release(req.params.id as string, reason, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  retry = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.recordRetry(req.params.id as string, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  sweepExpired = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const released = await this.service.releaseExpired();
      res.json({ released });
    } catch (err) {
      next(err);
    }
  };
}
