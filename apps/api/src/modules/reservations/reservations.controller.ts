import type { Request, Response, NextFunction } from 'express';
import { ReservationsService } from './reservations.service.js';
import { ReservationStatusEnum, SetDiscountSchema } from './reservations.types.js';
import type { CreateReservationDTO, UpdateReservationDTO } from './reservations.types.js';

export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  private getRequestMeta(req: Request) {
    // user id is carried in the JWT payload's `sub` claim (not `id`).
    return {
      userId: (req as any).user?.sub,
      ip: req.ip,
      requestId: (req as any).id,
    };
  }

  getReservations = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      let limit = parseInt(req.query.limit as string) || 20;
      if (limit > 100) limit = 100;
      
      const search = req.query.search as string | undefined;
      const statusRaw = req.query.status;
      const status = statusRaw ? ReservationStatusEnum.parse(statusRaw) : undefined;
      const room_id = req.query.room_id as string | undefined;
      const contact_id = req.query.contact_id as string | undefined;
      const property_id = (req.query.property_id as string) || undefined;

      const result = await this.service.getReservations(
        { search, status, room_id, contact_id, property_id },
        { page, limit }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getReservationById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reservation = await this.service.getReservationById(req.params.id as string);
      res.json(reservation);
    } catch (err) {
      next(err);
    }
  };

  checkAvailability = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { room_id, check_in_date, check_out_date } = req.query;
      if (!room_id || !check_in_date || !check_out_date) {
        res.status(400).json({ error: 'Missing required query params' });
        return;
      }
      const isAvailable = await this.service.checkAvailability(
        room_id as string, 
        new Date(check_in_date as string), 
        new Date(check_out_date as string)
      );
      res.json({ available: isAvailable });
    } catch (err) {
      next(err);
    }
  };

  createReservation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateReservationDTO;
      const meta = this.getRequestMeta(req);
      const reservation = await this.service.createReservation(dto, meta);
      res.status(201).json(reservation);
    } catch (err) {
      next(err);
    }
  };

  modifyReservation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpdateReservationDTO;
      const meta = this.getRequestMeta(req);
      const reservation = await this.service.modifyReservation(req.params.id as string, dto, meta);
      res.json(reservation);
    } catch (err) {
      next(err);
    }
  };

  getPricing = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.priceReservation(req.params.id as string));
    } catch (err) {
      next(err);
    }
  };

  setDiscount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = SetDiscountSchema.parse(req.body);
      const meta = this.getRequestMeta(req);
      const canApprove = (((req as any).user?.permissions ?? []) as string[]).includes('reservations.discount.approve');
      res.json(await this.service.setDiscount(req.params.id as string, dto, meta, canApprove));
    } catch (err) {
      next(err);
    }
  };

  approveDiscount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.approveDiscount(req.params.id as string, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  removeDiscount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.removeDiscount(req.params.id as string, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  cancelReservation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      const reservation = await this.service.cancelReservation(req.params.id as string, meta);
      res.json(reservation);
    } catch (err) {
      next(err);
    }
  };

  removeReservation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      await this.service.removeReservation(req.params.id as string, meta);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
