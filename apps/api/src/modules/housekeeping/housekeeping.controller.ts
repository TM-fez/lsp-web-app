import { Request, Response, NextFunction } from 'express';
import { HousekeepingService } from './housekeeping.service.js';
import {
  StartCleaningSchema,
  InspectSchema,
  ReadySchema,
  HousekeepingTaskStatusEnum,
  ChecklistItemCreateSchema,
  ChecklistItemUpdateSchema,
  SetCheckSchema,
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

  // ── Compliance checklist + turnaround ────────────────────────────────────────

  checklist = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ data: await this.service.checklist(req.query.include_inactive === 'true') });
    } catch (err) {
      next(err);
    }
  };

  addChecklistItem = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ChecklistItemCreateSchema.parse(req.body);
      res.status(201).json(await this.service.addChecklistItem(dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  updateChecklistItem = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ChecklistItemUpdateSchema.parse(req.body);
      res.json(await this.service.updateChecklistItem(req.params.itemId as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  roomChecks = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.roomChecks(req.params.roomId as string));
    } catch (err) {
      next(err);
    }
  };

  setRoomCheck = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = SetCheckSchema.parse(req.body);
      res.json(await this.service.setRoomCheck(req.params.roomId as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  turnaround = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
      res.json(await this.service.turnaround(req.activePropertyId as string, days));
    } catch (err) {
      next(err);
    }
  };
}
