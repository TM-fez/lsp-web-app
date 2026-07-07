import { LeadsRepository } from './leads.repository.js';
import { AppError } from '../../../core/errors/AppError.js';
import { ReservationsService } from '../../reservations/reservations.service.js';
import type { ReservationRow, LeadRow, NewLead, UpdateLead } from '../../../db/types.js';
import type { CreateReservationDTO } from '../../reservations/reservations.types.js';
import type { LeadFilters, LeadPaginationOptions, PaginatedLeadResult, LeadRequestMeta, CreateLeadDTO, UpdateLeadDTO, ConvertLeadDTO } from './leads.types.js';

// Lead channels don't line up 1:1 with reservation origins — map what we can.
const LEAD_TO_RESERVATION_SOURCE: Record<string, CreateReservationDTO['source']> = {
  WHATSAPP: 'PHONE',
  WALK_IN: 'WALK_IN',
  BOOKING_COM: 'BOOKING_COM',
  WEBSITE: 'WEBSITE',
  REFERRAL: 'OTHER',
  CORPORATE: 'CORPORATE',
  OTHER: 'OTHER',
};
const reservationSourceFor = (leadSource: string | null): CreateReservationDTO['source'] =>
  (leadSource && LEAD_TO_RESERVATION_SOURCE[leadSource]) || 'OTHER';

export class LeadsService {
  constructor(
    private readonly repository: LeadsRepository,
    private readonly reservations: ReservationsService,
  ) {}

  /**
   * Convert an enquiry into a booking: create a (PENDING) reservation for the lead's
   * guest, then mark the lead CONVERTED and link it. The reservation follows the
   * usual commercial invariant — only payment confirms it.
   */
  async convertLead(
    id: string,
    dto: ConvertLeadDTO,
    meta: LeadRequestMeta,
    activePropertyId?: string,
  ): Promise<{ reservation: ReservationRow; lead: LeadRow }> {
    const lead = await this.getLeadById(id);
    if (lead.status === 'CONVERTED') throw AppError.badRequest('This enquiry has already been converted to a booking.');
    if (lead.status === 'LOST') throw AppError.badRequest('This enquiry is marked lost — reopen it before converting.');

    const contactId = dto.contact_id ?? lead.contact_id;
    if (!contactId) throw AppError.badRequest('Choose a guest before converting this enquiry to a booking.');

    const reservation = await this.reservations.createReservation(
      {
        contact_id: contactId,
        room_id: dto.room_id,
        check_in_date: dto.check_in_date,
        check_out_date: dto.check_out_date,
        notes: dto.notes ?? `Converted from enquiry: ${lead.title}`,
        source: reservationSourceFor(lead.source),
        status: 'PENDING', // forced to PENDING by the service regardless; explicit for the type
      },
      meta,
      activePropertyId,
    );

    const updated = await this.repository.update(
      id,
      { status: 'CONVERTED', contact_id: contactId, converted_reservation_id: reservation.id, updated_by: meta.userId },
      meta,
    );

    return { reservation, lead: updated ?? lead };
  }

  async getLeadById(id: string): Promise<LeadRow> {
    const lead = await this.repository.findById(id);
    if (!lead) {
      throw AppError.notFound(`Lead with id ${id} not found`);
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
      throw AppError.notFound(`Failed to update lead with id ${id}`);
    }
    return updated;
  }

  async deleteLead(id: string, meta: LeadRequestMeta): Promise<void> {
    // Ensure lead exists
    await this.getLeadById(id);

    const success = await this.repository.softDelete(id, meta);
    if (!success) {
      throw AppError.notFound(`Failed to delete lead with id ${id}`);
    }
  }
}
