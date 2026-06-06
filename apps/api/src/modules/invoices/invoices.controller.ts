import type { Request, Response, NextFunction } from 'express';
import { InvoicesService } from './invoices.service.js';
import { InvoiceKindEnum, InvoiceStatusEnum } from './invoices.types.js';
import type { IssueInvoiceDTO, SettleInvoiceDTO, RefundInvoiceDTO } from './invoices.types.js';

export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  private getRequestMeta(req: Request) {
    return { userId: req.user!.sub, ip: req.ip, requestId: req.id };
  }

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
      const status = req.query.status ? InvoiceStatusEnum.parse(req.query.status) : undefined;
      const kind = req.query.kind ? InvoiceKindEnum.parse(req.query.kind) : undefined;
      const quote_id = req.query.quote_id as string | undefined;
      const hold_id = req.query.hold_id as string | undefined;
      res.json(await this.service.listInvoices({ status, kind, quote_id, hold_id }, { page, limit }));
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

  issue = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as IssueInvoiceDTO;
      res.status(201).json(await this.service.issueInvoice(dto, this.getRequestMeta(req)));
    } catch (err) {
      next(err);
    }
  };

  settle = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as SettleInvoiceDTO;
      res.json(await this.service.settleInvoice(req.params.id as string, dto.receipt_file_id, this.getRequestMeta(req)));
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
