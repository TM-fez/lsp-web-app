import { LeadsRepository } from './leads.repository';
import type { LeadRow, NewLead, UpdateLead } from '../../../../db/types';
import type { LeadFilters, LeadPaginationOptions, PaginatedLeadResult, LeadRequestMeta, CreateLeadDTO, UpdateLeadDTO } from './leads.types';

export class LeadsService {
  constructor(private readonly repository: LeadsRepository) {}

  async getLeadById(id: string): Promise<LeadRow> {
    const lead = await this.repository.findById(id);
    if (!lead) {
      throw new Error(`Lead with id ${id} not found`);
    }
    return lead;
  }

  async getLeads(
    filters: LeadFilters,
    pagination: LeadPaginationOptions
  ): Promise<PaginatedLeadResult<LeadRow>> {
    return this.repository.findPaginated(filters, pagination);
  }

  async createLead(dto: CreateLeadDTO, meta: LeadRequestMeta): Promise<LeadRow> {
    const newLead: NewLead = {
      ...dto,
      created_by: meta.userId,
      updated_by: meta.userId,
    };
    return this.repository.create(newLead, meta);
  }

  async updateLead(id: string, dto: UpdateLeadDTO, meta: LeadRequestMeta): Promise<LeadRow> {
    // Ensure lead exists
    await this.getLeadById(id);
    
    const updatePayload: UpdateLead = {
      ...dto,
      updated_by: meta.userId,
    };
    
    const updated = await this.repository.update(id, updatePayload, meta);
    if (!updated) {
      throw new Error(`Failed to update lead with id ${id}`);
    }
    return updated;
  }

  async deleteLead(id: string, meta: LeadRequestMeta): Promise<void> {
    // Ensure lead exists
    await this.getLeadById(id);

    const success = await this.repository.softDelete(id, meta);
    if (!success) {
      throw new Error(`Failed to delete lead with id ${id}`);
    }
  }
}
