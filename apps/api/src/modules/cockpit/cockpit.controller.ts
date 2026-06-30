import { Request, Response, NextFunction } from 'express';
import { CockpitService } from './cockpit.service.js';

export class CockpitController {
  constructor(private readonly service: CockpitService) {}

  board = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.board(req.activePropertyId));
    } catch (err) {
      next(err);
    }
  };
}
