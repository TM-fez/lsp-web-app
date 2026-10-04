import type { Request, Response, NextFunction } from 'express';
import { LeadsService } from './leads.service.js';
import { LeadStatusEnum, LeadSourceEnum } from './leads.types.js';
import type { CreateLeadDTO, UpdateLeadDTO, ConvertLeadDTO, LeadScope } from './leads.types.js';
import { propertyScopeForUser } from '../../../core/scope/propertyScope.js';
import { ACTIVE_PROPERTY_HEADER, userCanAccessProperty } from '../../../core/scope/activeProperty.js';
import { AppError } from '../../../core/errors/AppError.js';

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

  /** Who is asking, plus the property they are working in if the app sent a valid one. */
  private async scope(req: Request): Promise<LeadScope> {
    const user = req.user!;
    const base = await propertyScopeForUser(user.sub, user.role);
    const raw = req.headers[ACTIVE_PROPERTY_HEADER];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (header && !(await userCanAccessProperty(user.sub, user.role, header))) {
      throw AppError.forbidden('You do not have access to this property');
    }
    return { userId: user.sub, ids: base.ids, allProperties: base.allProperties, activePropertyId: header || undefined };
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
        { page, limit },
        await this.scope(req)
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getLeadById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lead = await this.service.getLeadById(req.params.id as string, await this.scope(req));
      res.json(lead);
    } catch (err) {
      next(err);
    }
  };

  createLead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateLeadDTO;
      const meta = this.getRequestMeta(req);
      const lead = await this.service.createLead(dto, meta, await this.scope(req));
      res.status(201).json(lead);
    } catch (err) {
      next(err);
    }
  };

  updateLead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpdateLeadDTO;
      const meta = this.getRequestMeta(req);
      const lead = await this.service.updateLead(req.params.id as string, dto, meta, await this.scope(req));
      res.json(lead);
    } catch (err) {
      next(err);
    }
  };

  deleteLead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      await this.service.deleteLead(req.params.id as string, meta, await this.scope(req));
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
        await this.scope(req),
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };
}
