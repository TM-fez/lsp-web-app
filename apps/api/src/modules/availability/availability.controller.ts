import type { Request, Response, NextFunction } from 'express';
import { AvailabilityService } from './availability.service.js';
import { 
  AvailabilityQuerySchema, 
  AvailabilityCalendarSchema, 
  AvailabilityQuoteSchema 
} from './availability.types.js';

export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  getRoomAvailability = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = AvailabilityQuerySchema.parse(req.query);
      const result = await this.service.getRoomAvailability(query, req.activePropertyId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getAvailableRooms = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = AvailabilityQuerySchema.parse(req.query);
      const result = await this.service.getAvailableRooms(query, req.activePropertyId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getQuote = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = AvailabilityQuoteSchema.parse(req.body);
      const result = await this.service.getQuote(query, req.activePropertyId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getCalendar = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = AvailabilityCalendarSchema.parse(req.query);
      const result = await this.service.getCalendar(query, req.activePropertyId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };
}
