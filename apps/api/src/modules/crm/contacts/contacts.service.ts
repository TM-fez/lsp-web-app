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

  /**
   * (R5 retest) Two guest records with one email split a guest's history and send them
   * marketing twice. It isn't always wrong — a family or a company's travel desk can share
   * one — so it is a question, not a ban: refused with a distinct error label the web turns
   * into "Save anyway", which resends with `allow_duplicate_email`. The message never names
   * the other guest: they may belong to a property this person can't see.
   */
  private async assertEmailFree(email: string | null | undefined, allow: boolean | undefined, excludeId?: string) {
    if (!email || allow) return;
    if (await this.repository.emailInUse(email, excludeId)) {
      throw new AppError(
        409,
        'Duplicate Email',
        'Another guest already uses this email. Search for them first — or save anyway if they really share it.',
      );
    }
  }

  async createContact(dto: CreateContactDTO, meta: CRMRequestMeta): Promise<ContactRow> {
    const { allow_duplicate_email, ...fields } = dto;
    await this.assertEmailFree(fields.email, allow_duplicate_email);
    const newContact: NewContact = {
      ...fields,
      created_by: meta.userId,
      updated_by: meta.userId,
    };
    return this.repository.create(newContact, meta);
  }

  async updateContact(id: string, dto: UpdateContactDTO, meta: CRMRequestMeta, viewer?: ContactViewer): Promise<ContactRow> {
    // Ensure contact exists (and is one this person may see)
    await this.getContactById(id, viewer);
    const { allow_duplicate_email, ...fields } = dto;
    await this.assertEmailFree(fields.email, allow_duplicate_email, id);

    const updatePayload: UpdateContact = {
      ...fields,
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
