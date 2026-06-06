import type { Request, Response, NextFunction } from 'express';
import { PaymentsService } from './payments.service.js';
import { PaymentStatusEnum } from './payments.types.js';
import type { CreatePaymentIntentDTO, AttemptPaymentDTO } from './payments.types.js';

export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  private getRequestMeta(req: Request) {
    return { userId: req.user!.sub, ip: req.ip, requestId: req.id };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
      const status = req.query.status ? PaymentStatusEnum.parse(req.query.status) : undefined;
      const hold_id = req.query.hold_id as string | undefined;
      res.json(await this.service.listIntents({ status, hold_id }, { page, limit }));
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getIntentWithAttempts(req.params.id as string));
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreatePaymentIntentDTO;
      res.status(201).json(await this.service.createIntent(dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  attempt = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as AttemptPaymentDTO;
      res.json(await this.service.attempt(req.params.id as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };
}
