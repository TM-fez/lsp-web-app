import type { Request, Response, NextFunction } from 'express';
import { InvoicesService } from './invoices.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { userCanAccessProperty } from '../../core/scope/activeProperty.js';
import { InvoiceListQuerySchema } from './invoices.types.js';
import type { IssueInvoiceDTO, SettleInvoiceDTO, RefundInvoiceDTO } from './invoices.types.js';

export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  private getRequestMeta(req: Request) {
    return { userId: req.user!.sub, ip: req.ip, requestId: req.id };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Every query-string filter is validated and then ACTUALLY APPLIED. This used to
      // read page/limit/status/kind/ids by hand and drop everything else on the floor —
      // outstanding, search, dates and a property_id all returned an unfiltered list.
      const parsed = InvoiceListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw AppError.badRequest(parsed.error.errors.map((e) => e.message).join('; '));
      }
      const { page, limit, property_id: requested, ...filters } = parsed.data;

      // The active property (X-Property-Id, already validated by requireActiveProperty)
      // is the default scope. An explicit property_id is honoured when the caller may
      // enter that property — never silently overridden, never a way past membership.
      let property_id = req.activePropertyId;
      if (requested && requested !== req.activePropertyId) {
        const allowed = await userCanAccessProperty(req.user!.sub, req.user!.role, requested);
        if (!allowed) throw AppError.forbidden('You do not have access to this property');
        property_id = requested;
      }

      res.json(await this.service.listInvoices({ ...filters, property_id }, { page, limit }));
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getInvoice(req.params.id as string));
    } catch (err) {
      next(err);
    }
  };

  document = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.getInvoiceDocument(req.params.id as string));
    } catch (err) {
      next(err);
    }
  };

  send = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await this.service.sendInvoiceToGuest(req.params.id as string, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  issue = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as IssueInvoiceDTO;
      res.status(201).json(await this.service.issueInvoice(dto, this.getRequestMeta(req), req.activePropertyId));
    } catch (err) {
      next(err);
    }
  };

  settle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as SettleInvoiceDTO;
      res.json(await this.service.settleInvoice(req.params.id as string, dto.receipt_file_id, this.getRequestMeta(req), dto.method));
    } catch (err) {
      next(err);
    }
  };

  refund = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as RefundInvoiceDTO;
      res.status(201).json(await this.service.refundInvoice(req.params.id as string, dto.amount, dto.reason, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };
}
