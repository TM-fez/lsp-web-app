import { accessiblePropertyIdsForUser } from '../../core/scope/activeProperty.js';
import type { Request, Response, NextFunction } from 'express';
import { PropertiesService } from './properties.service.js';
import {
  CreatePropertySchema,
  UpdatePropertySchema,
  CreateBuildingSchema,
  UpdateBuildingSchema,
} from './properties.types.js';

export class PropertiesController {
  constructor(private readonly service: PropertiesService) {}

  private getRequestMeta(req: Request) {
    return {
      userId: (req as any).user?.sub,
      ip: req.ip,
      requestId: (req as any).id,
    };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // (Re-test 3) A CBD-only user saw every property and all 25 units here. Admins see
      // all; anyone else only the properties they belong to.
      const ids = await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role);
      const all = await this.service.listWithBuildings();
      res.json(ids === null ? all : all.filter((p) => ids.includes(p.id)));
    } catch (err) {
      next(err);
    }
  };

  createProperty = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreatePropertySchema.parse(req.body);
      res.status(201).json(await this.service.createProperty(dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  updateProperty = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdatePropertySchema.parse(req.body);
      res.json(await this.service.updateProperty(req.params.id as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  createBuilding = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateBuildingSchema.parse(req.body);
      res.status(201).json(await this.service.createBuilding(req.params.id as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  updateBuilding = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateBuildingSchema.parse(req.body);
      res.json(await this.service.updateBuilding(req.params.buildingId as string, dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };
}
