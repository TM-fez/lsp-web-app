import type { Request, Response, NextFunction } from 'express';
import { RoomsService } from './rooms.service.js';
import { RoomStatusEnum, RoomTypeEnum } from './rooms.types.js';
import type { CreateRoomDTO, UpdateRoomDTO, UpdateChannelConfigDTO } from './rooms.types.js';

export class RoomsController {
  constructor(private readonly service: RoomsService) {}

  private getRequestMeta(req: Request) {
    // user id is carried in the JWT payload's `sub` claim (not `id`).
    return {
      userId: (req as any).user?.sub,
      ip: req.ip,
      requestId: (req as any).id,
    };
  }

  getRooms = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      let limit = parseInt(req.query.limit as string) || 20;
      if (limit > 100) limit = 100;

      const search = req.query.search as string | undefined;
      const statusRaw = req.query.status;
      const status = statusRaw ? RoomStatusEnum.parse(statusRaw) : undefined;
      const typeRaw = req.query.type;
      const type = typeRaw ? RoomTypeEnum.parse(typeRaw) : undefined;
      // Property scope is server-enforced: always the validated active property.
      const property_id = req.activePropertyId;
      const building_id = (req.query.building_id as string) || undefined;

      const result = await this.service.getRooms({ search, status, type, property_id, building_id }, { page, limit });
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  listAvailable = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rooms = await this.service.listAvailable(req.activePropertyId);
      res.json({ data: rooms });
    } catch (err) {
      next(err);
    }
  };

  getRoomById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const room = await this.service.getRoomById(req.params.id as string);
      res.json(room);
    } catch (err) {
      next(err);
    }
  };

  createRoom = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateRoomDTO;
      const meta = this.getRequestMeta(req);
      const room = await this.service.createRoom(dto, meta);
      res.status(201).json(room);
    } catch (err) {
      next(err);
    }
  };

  updateRoom = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpdateRoomDTO;
      const meta = this.getRequestMeta(req);
      const room = await this.service.updateRoom(req.params.id as string, dto, meta);
      res.json(room);
    } catch (err) {
      next(err);
    }
  };

  setChannelConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpdateChannelConfigDTO;
      const meta = this.getRequestMeta(req);
      res.json(await this.service.setChannelConfig(req.params.id as string, dto, meta));
    } catch (err) {
      next(err);
    }
  };

  rotateIcalToken = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      res.json(await this.service.rotateIcalToken(req.params.id as string, meta));
    } catch (err) {
      next(err);
    }
  };

  setMaintenance = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      const room = await this.service.setMaintenance(req.params.id as string, meta);
      res.json(room);
    } catch (err) {
      next(err);
    }
  };

  setOutOfService = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      const room = await this.service.setOutOfService(req.params.id as string, meta);
      res.json(room);
    } catch (err) {
      next(err);
    }
  };

  restoreRoom = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      const room = await this.service.restoreRoom(req.params.id as string, meta);
      res.json(room);
    } catch (err) {
      next(err);
    }
  };

  deleteRoom = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      await this.service.deleteRoom(req.params.id as string, meta);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
