import { Request, Response, NextFunction } from 'express';
import { MaintenanceService } from './maintenance.service.js';
import { 
  CreateWorkOrderSchema, 
  UpdateWorkOrderSchema, 
  CompleteWorkOrderSchema, 
  StartWorkOrderSchema, 
  AssignWorkOrderSchema,
  MaintenanceStatusEnum
} from './maintenance.types.js';

export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  private getRequestMeta(req: Request) {
    return {
      userId: req.user!.sub,
      requestId: req.id,
    };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const room_id = req.query.room_id as string | undefined;
      const status = req.query.status as string | undefined;
      const assigned_to = req.query.assigned_to as string | undefined;

      let parsedStatus;
      if (status) {
        parsedStatus = MaintenanceStatusEnum.parse(status);
      }

      const result = await this.service.list({ 
        page, 
        limit: Math.min(limit, 100), 
        room_id, 
        status: parsedStatus, 
        assigned_to 
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.service.get(req.params.id as string);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = CreateWorkOrderSchema.parse(req.body);
      const meta = this.getRequestMeta(req);
      const result = await this.service.openWorkOrder(data, meta);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = UpdateWorkOrderSchema.parse(req.body);
      const meta = this.getRequestMeta(req);
      const result = await this.service.update(req.params.id as string, data, meta);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  assign = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = AssignWorkOrderSchema.parse(req.body);
      const meta = this.getRequestMeta(req);
      const result = await this.service.assign(req.params.id as string, data, meta);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  start = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = StartWorkOrderSchema.parse(req.body);
      const meta = this.getRequestMeta(req);
      const result = await this.service.start(req.params.id as string, data, meta);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  complete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = CompleteWorkOrderSchema.parse(req.body);
      const meta = this.getRequestMeta(req);
      const result = await this.service.complete(req.params.id as string, data, meta);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  cancel = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const restoreRoom = req.body.restore_room === true;
      const meta = this.getRequestMeta(req);
      const result = await this.service.cancel(req.params.id as string, restoreRoom, meta);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}
