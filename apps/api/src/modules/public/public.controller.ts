import type { Request, Response, NextFunction } from 'express';
import { PublicService } from './public.service.js';
import { CreateBookingSchema } from './public.types.js';

export class PublicController {
  constructor(private readonly service: PublicService) {}

  getStayInfo = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getStayInfo());
    } catch (err) {
      next(err);
    }
  };

  createBooking = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateBookingSchema.parse(req.body);
      const result = await this.service.createBooking(dto, { ip: req.ip, requestId: (req as any).id });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };
}
