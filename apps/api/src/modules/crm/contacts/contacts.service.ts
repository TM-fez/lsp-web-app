import { ContactsRepository } from './contacts.repository.js';
import { AppError } from '../../../core/errors/AppError.js';
import type { ContactRow, NewContact, UpdateContact } from '../../../db/types.js';
import type { ContactFilters, ContactViewer, PaginationOptions, PaginatedResult, CRMRequestMeta, CreateContactDTO, UpdateContactDTO } from '../crm.types.js';

export class ContactsService {
  constructor(private readonly repository: ContactsRepository) {}

  /** A guest the viewer may not see is "not found" — a 403 would confirm it exists. */
  async getContactById(id: string, viewer?: ContactViewer): Promise<ContactRow> {
    const contact = await this.repository.findById(id, viewer);
    if (!contact) {
      throw AppError.notFound(`Contact with id ${id} not found`);
    }
    return contact;
  }

  async getContacts(
    filters: ContactFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<ContactRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async createContact(dto: CreateContactDTO, meta: CRMRequestMeta): Promise<ContactRow> {
    const newContact: NewContact = {
      ...dto,
      created_by: meta.userId,
      updated_by: meta.userId,
    };
    return this.repository.create(newContact, meta);
  }

  async updateContact(id: string, dto: UpdateContactDTO, meta: CRMRequestMeta, viewer?: ContactViewer): Promise<ContactRow> {
    // Ensure contact exists (and is one this person may see)
    await this.getContactById(id, viewer);
    
    const updatePayload: UpdateContact = {
      ...dto,
      updated_by: meta.userId,
    };
    
    const updated = await this.repository.update(id, updatePayload, meta);
    if (!updated) {
      throw AppError.notFound(`Failed to update contact with id ${id}`);
    }
    return updated;
  }

  async deleteContact(id: string, meta: CRMRequestMeta, viewer?: ContactViewer): Promise<void> {
    // Ensure contact exists (and is one this person may see)
    await this.getContactById(id, viewer);

    const success = await this.repository.softDelete(id, meta);
    if (!success) {
      throw AppError.notFound(`Failed to delete contact with id ${id}`);
    }
  }
}
