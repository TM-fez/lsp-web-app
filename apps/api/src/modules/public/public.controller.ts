import type { Request, Response, NextFunction } from 'express';
import { PublicService } from './public.service.js';
import { CreateBookingSchema, LookupBookingSchema, GuestTokenSchema, SelfCheckinSchema } from './public.types.js';

export class PublicController {
  constructor(private readonly service: PublicService) {}

  getStayInfo = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getStayInfo());
    } catch (err) {
      next(err);
    }
  };

  lookupBooking = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = LookupBookingSchema.parse(req.query);
      res.json(await this.service.lookupBooking(dto));
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

  // GET /public/checkin?token=… — the in-apartment QR page's context.
  getCheckinInfo = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = GuestTokenSchema.parse(req.query);
      res.json(await this.service.getCheckinInfo(token));
    } catch (err) {
      next(err);
    }
  };

  // POST /public/checkin — the guest confirms their own details.
  submitCheckin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = SelfCheckinSchema.parse(req.body);
      res.json(await this.service.submitSelfCheckin(dto, { ip: req.ip, requestId: (req as any).id }));
    } catch (err) {
      next(err);
    }
  };
}
