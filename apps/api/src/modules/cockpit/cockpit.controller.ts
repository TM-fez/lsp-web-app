import { Request, Response, NextFunction } from 'express';
import { CockpitService } from './cockpit.service.js';

export class CockpitController {
  constructor(private readonly service: CockpitService) {}

  board = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.board());
    } catch (err) {
      next(err);
    }
  };
}
