import type { Request, Response, NextFunction } from 'express';
import { ContactsService } from './contacts.service';
import { CreateContactSchema, UpdateContactSchema } from '../crm.types';

export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  private getRequestMeta(req: Request) {
    // Assuming req.user is set by auth middleware
    return {
      userId: (req as any).user?.id,
      ip: req.ip,
      requestId: (req as any).id, // Or req.headers['x-request-id']
    };
  }

  getContacts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      let limit = parseInt(req.query.limit as string) || 20;
      if (limit > 100) limit = 100;
      const search = req.query.search as string | undefined;
      const type = req.query.type as 'individual' | 'company' | undefined;

      const result = await this.service.getContacts(
        { search, type },
        { page, limit }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getContactById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contact = await this.service.getContactById(req.params.id);
      res.json(contact);
    } catch (err) {
      next(err);
    }
  };

  createContact = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateContactSchema.parse(req.body);
      const meta = this.getRequestMeta(req);
      const contact = await this.service.createContact(dto, meta);
      res.status(201).json(contact);
    } catch (err) {
      next(err);
    }
  };

  updateContact = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateContactSchema.parse(req.body);
      const meta = this.getRequestMeta(req);
      const contact = await this.service.updateContact(req.params.id, dto, meta);
      res.json(contact);
    } catch (err) {
      next(err);
    }
  };

  deleteContact = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      await this.service.deleteContact(req.params.id, meta);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
