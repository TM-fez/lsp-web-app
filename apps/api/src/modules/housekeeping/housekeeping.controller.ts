import { Request, Response, NextFunction } from 'express';
import { HousekeepingService } from './housekeeping.service.js';
import {
  StartCleaningSchema,
  InspectSchema,
  ReadySchema,
  HousekeepingTaskStatusEnum,
} from './housekeeping.types.js';

export class HousekeepingController {
  constructor(private readonly service: HousekeepingService) {}

  private getRequestMeta(req: Request) {
    return { userId: req.user!.sub, requestId: req.id };
  }

  queue = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ data: await this.service.queue(req.activePropertyId) });
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const room_id = req.query.room_id as string | undefined;
      const assigned_to = req.query.assigned_to as string | undefined;
      const status = req.query.status ? HousekeepingTaskStatusEnum.parse(req.query.status) : undefined;

      res.json(await this.service.list({ page, limit, room_id, assigned_to, status }, req.activePropertyId));
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

  start = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = StartCleaningSchema.parse(req.body);
      res.json(await this.service.start(req.params.roomId as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  inspect = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = InspectSchema.parse(req.body);
      res.json(await this.service.inspect(req.params.roomId as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  ready = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ReadySchema.parse(req.body);
      res.json(await this.service.ready(req.params.roomId as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };
}
