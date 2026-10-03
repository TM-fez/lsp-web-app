import type { Request, Response, NextFunction } from 'express';
import type { SettingsService } from './settings.service.js';
import type { UpdateSettingsDTO } from './settings.types.js';

export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  private meta(req: Request) {
    return { userId: req.user!.sub, ip: req.ip, requestId: (req as unknown as { id?: string }).id };
  }

  get = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.get());
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.update(req.body as UpdateSettingsDTO, this.meta(req)));
    } catch (err) {
      next(err);
    }
  };
}

