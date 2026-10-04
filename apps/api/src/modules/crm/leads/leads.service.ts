import { LeadsRepository } from './leads.repository.js';
import { AppError } from '../../../core/errors/AppError.js';
import { ReservationsService } from '../../reservations/reservations.service.js';
import type { ReservationRow, LeadRow, NewLead, UpdateLead } from '../../../db/types.js';
import type { CreateReservationDTO } from '../../reservations/reservations.types.js';
import type { LeadFilters, LeadPaginationOptions, PaginatedLeadResult, LeadRequestMeta, CreateLeadDTO, UpdateLeadDTO, ConvertLeadDTO, LeadScope } from './leads.types.js';

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
    scope?: LeadScope,
  ): Promise<{ reservation: ReservationRow; lead: LeadRow }> {
    const lead = await this.getLeadById(id, scope);
    if (lead.status === 'CONVERTED') throw AppError.badRequest('This enquiry has already been converted to a booking.');
    if (lead.status === 'LOST') throw AppError.badRequest('This enquiry is marked lost — reopen it before converting.');

    const contactId = dto.contact_id ?? lead.contact_id;
    if (!contactId) throw AppError.badRequest('Choose a guest before converting this enquiry to a booking.');

    // Claim first, atomically — only one of several simultaneous clicks gets past here.
    const claim = await this.repository.claimForConversion(id, contactId, meta);
    if (!claim) throw AppError.conflict('This enquiry has just been converted to a booking by someone else.');

    let reservation: ReservationRow;
    try {
      reservation = await this.reservations.createReservation(
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
    } catch (err) {
      // No booking was made (unit taken, bad dates…): the enquiry goes back to how it was.
      await this.repository.update(id, { status: claim.previousStatus, updated_by: meta.userId }, meta);
      throw err;
    }

    const updated = await this.repository.update(
      id,
      {
        converted_reservation_id: reservation.id,
        // The booking is in the active property, so the enquiry now belongs there too
        // (an unassigned website enquiry is claimed by whoever converts it).
        ...(lead.property_id ? {} : activePropertyId ? { property_id: activePropertyId } : {}),
        updated_by: meta.userId,
      },
      meta,
    );

    return { reservation, lead: updated ?? lead };
  }

  async getLeadById(id: string, scope?: LeadScope): Promise<LeadRow> {
    const lead = await this.repository.findById(id, scope);
    if (!lead) {
      throw AppError.notFound(`Lead with id ${id} not found`);
    }
    return lead;
  }

  async getLeads(
    filters: LeadFilters,
    pagination: LeadPaginationOptions,
    scope?: LeadScope
  ): Promise<PaginatedLeadResult<LeadRow>> {
    return this.repository.findPaginated(filters, pagination, scope);
  }

  /** A property named for a lead must be one the caller works in (admin / every-property: any). */
  private assertPropertyAllowed(propertyId: string, scope?: LeadScope) {
    if (scope && !scope.allProperties && !(scope.ids ?? []).includes(propertyId)) {
      throw AppError.forbidden('Choose one of your own properties for this enquiry.');
    }
  }

  async createLead(dto: CreateLeadDTO, meta: LeadRequestMeta, scope?: LeadScope): Promise<LeadRow> {
    // Property: what was asked for, else the property the user is working in, else none.
    const propertyId = dto.property_id === undefined ? scope?.activePropertyId : dto.property_id;
    if (propertyId) this.assertPropertyAllowed(propertyId, scope);
    const newLead: NewLead = {
      ...dto,
      ...(propertyId !== undefined ? { property_id: propertyId } : {}),
      created_by: meta.userId,
      updated_by: meta.userId,
    };
    return this.repository.create(newLead, meta);
  }

  async updateLead(id: string, dto: UpdateLeadDTO, meta: LeadRequestMeta, scope?: LeadScope): Promise<LeadRow> {
    // Ensure the lead exists AND is one the caller may see (else "not found")
    const existing = await this.getLeadById(id, scope);
    if (dto.property_id) this.assertPropertyAllowed(dto.property_id, scope);
    // Taking a lead OUT of every property is for its creator or an every-property user; a
    // limited user could otherwise hide it from their colleagues.
    if (dto.property_id === null && scope && !scope.allProperties && existing.created_by !== scope.userId) {
      throw AppError.forbidden('Only the person who logged this enquiry can leave it without a property.');
    }

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

  async deleteLead(id: string, meta: LeadRequestMeta, scope?: LeadScope): Promise<void> {
    // Ensure the lead exists and is in scope
    await this.getLeadById(id, scope);

    const success = await this.repository.softDelete(id, meta);
    if (!success) {
      throw AppError.notFound(`Failed to delete lead with id ${id}`);
    }
  }
}
