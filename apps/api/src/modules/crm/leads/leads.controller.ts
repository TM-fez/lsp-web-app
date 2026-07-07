import type { Request, Response, NextFunction } from 'express';
import { LeadsService } from './leads.service.js';
import { LeadStatusEnum, LeadSourceEnum } from './leads.types.js';
import type { CreateLeadDTO, UpdateLeadDTO, ConvertLeadDTO } from './leads.types.js';

export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  private getRequestMeta(req: Request) {
    // user id is carried in the JWT payload's `sub` claim (not `id`).
    return {
      userId: (req as any).user?.sub,
      ip: req.ip,
      requestId: (req as any).id,
    };
  }

  getLeads = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      let limit = parseInt(req.query.limit as string) || 20;
      if (limit > 100) limit = 100;
      const search = req.query.search as string | undefined;
      const statusRaw = req.query.status;
      const status = statusRaw ? LeadStatusEnum.parse(statusRaw) : undefined;
      const sourceRaw = req.query.source;
      const source = sourceRaw ? LeadSourceEnum.parse(sourceRaw) : undefined;

      const result = await this.service.getLeads(
        { search, status, source },
        { page, limit }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getLeadById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lead = await this.service.getLeadById(req.params.id as string);
      res.json(lead);
    } catch (err) {
      next(err);
    }
  };

  createLead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateLeadDTO;
      const meta = this.getRequestMeta(req);
      const lead = await this.service.createLead(dto, meta);
      res.status(201).json(lead);
    } catch (err) {
      next(err);
    }
  };

  updateLead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpdateLeadDTO;
      const meta = this.getRequestMeta(req);
      const lead = await this.service.updateLead(req.params.id as string, dto, meta);
      res.json(lead);
    } catch (err) {
      next(err);
    }
  };

  deleteLead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      await this.service.deleteLead(req.params.id as string, meta);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  // POST /leads/:id/convert — turn the enquiry into a (PENDING) booking.
  convertLead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      const result = await this.service.convertLead(
        req.params.id as string,
        req.body as ConvertLeadDTO,
        meta,
        req.activePropertyId,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };
}
