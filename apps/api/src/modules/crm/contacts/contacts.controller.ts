import type { Request, Response, NextFunction } from 'express';
import { ContactsService } from './contacts.service.js';
import type { ContactViewer, CreateContactDTO, UpdateContactDTO } from '../crm.types.js';
import { accessiblePropertyIdsForUser } from '../../../core/scope/activeProperty.js';
import { parsePageQuery } from '../../../core/http/pagination.js';

export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  /** (2026-10-04) Property-limited staff see only their properties' guests. */
  private async viewer(req: Request): Promise<ContactViewer> {
    return {
      propertyIds: await accessiblePropertyIdsForUser(req.user!.sub, req.user!.role),
      userId: req.user!.sub,
    };
  }

  private getRequestMeta(req: Request) {
    // req.user is the JWT payload set by the authenticate middleware; the user
    // id is carried in `sub` (not `id`).
    return {
      userId: (req as any).user?.sub,
      ip: req.ip,
      requestId: (req as any).id,
    };
  }

  getContacts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit } = parsePageQuery(req.query);
      const search = req.query.search as string | undefined;
      const type = req.query.type as 'individual' | 'company' | undefined;
      const sort = req.query.sort === 'stays' ? 'stays' : undefined;

      const result = await this.service.getContacts(
        { search, type, sort, visibleTo: await this.viewer(req) },
        { page, limit }
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getContactById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contact = await this.service.getContactById(req.params.id as string, await this.viewer(req));
      res.json(contact);
    } catch (err) {
      next(err);
    }
  };

  createContact = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as CreateContactDTO;
      const meta = this.getRequestMeta(req);
      const contact = await this.service.createContact(dto, meta);
      res.status(201).json(contact);
    } catch (err) {
      next(err);
    }
  };

  updateContact = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpdateContactDTO;
      const meta = this.getRequestMeta(req);
      const contact = await this.service.updateContact(req.params.id as string, dto, meta, await this.viewer(req));
      res.json(contact);
    } catch (err) {
      next(err);
    }
  };

  deleteContact = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      await this.service.deleteContact(req.params.id as string, meta, await this.viewer(req));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
