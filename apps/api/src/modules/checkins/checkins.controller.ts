import type { Request, Response, NextFunction } from 'express';
import { CheckinsService } from './checkins.service.js';
import { OccupancyStatusEnum } from './checkins.types.js';
import type { CreateCheckInDTO, CheckOutDTO } from './checkins.types.js';

export class CheckinsController {
  constructor(private readonly service: CheckinsService) {}

  private getRequestMeta(req: Request) {
    // user id is carried in the JWT payload's `sub` claim (not `id`).
    return {
      userId: (req as any).user?.sub,
      ip: req.ip,
      requestId: (req as any).id,
    };
  }

  listOccupancy = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      let limit = parseInt(req.query.limit as string) || 20;
      if (limit > 100) limit = 100;

      const statusRaw = req.query.status;
      const status = statusRaw ? OccupancyStatusEnum.parse(statusRaw) : undefined;
      const room_id = req.query.room_id as string | undefined;
      const reservation_id = req.query.reservation_id as string | undefined;

      const result = await this.service.listOccupancy({ status, room_id, reservation_id }, { page, limit });
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  listActive = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await this.service.listActive();
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  };

  getOccupancyById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const occupancy = await this.service.getOccupancyById(req.params.id as string);
      res.json(occupancy);
    } catch (err) {
      next(err);
    }
  };

  checkIn = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateCheckInDTO;
      const meta = this.getRequestMeta(req);
      const occupancy = await this.service.checkIn(dto, meta);
      res.status(201).json(occupancy);
    } catch (err) {
      next(err);
    }
  };

  checkOut = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CheckOutDTO;
      const meta = this.getRequestMeta(req);
      const occupancy = await this.service.checkOut(req.params.id as string, dto, meta);
      res.json(occupancy);
    } catch (err) {
      next(err);
    }
  };
}
