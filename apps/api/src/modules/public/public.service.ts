import { PublicRepository } from './public.repository.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { ContactsRepository } from '../crm/contacts/contacts.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { CreateBookingDTO, PublicRequestMeta, StayUnitOption } from './public.types.js';
import type { UnitType } from '../pricing/pricing.types.js';

const unitLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export class PublicService {
  constructor(
    private readonly repository: PublicRepository,
    private readonly reservations: ReservationsService,
    private readonly contacts: ContactsRepository,
  ) {}

  /** Bookable layouts + from-prices for the public site. No PII, no availability. */
  async getStayInfo(): Promise<{ units: StayUnitOption[] }> {
    return { units: await this.repository.activePlans() };
  }

  /**
   * Create a booking request from the public site: find/create the guest, find a
   * free unit of the requested type, and create a PENDING reservation (the same
   * money-loop invariant — only payment confirms it). Returns a confirmation.
   */
  async createBooking(dto: CreateBookingDTO, meta: PublicRequestMeta) {
    const actorId = await this.repository.systemActorId();
    const actorMeta = { userId: actorId, ip: meta.ip, requestId: meta.requestId };

    // Find (by email) or create the guest contact.
    let contact = await this.repository.findContactByEmail(dto.email);
    if (!contact) {
      contact = await this.contacts.create(
        {
          type: 'individual',
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          notes: 'Created from a website booking',
          created_by: actorId,
          updated_by: actorId,
        },
        actorMeta,
      );
    }

    // Pick the first unit of the requested type that's free for the dates.
    const candidates = await this.repository.bookableRoomsByType(dto.unit_type as UnitType);
    let chosen: { id: string; code: string; name: string } | undefined;
    for (const room of candidates) {
      if (await this.reservations.checkAvailability(room.id, dto.check_in, dto.check_out)) {
        chosen = room;
        break;
      }
    }
    if (!chosen) {
      throw AppError.conflict(`No ${unitLabel(dto.unit_type)} is available for those dates. Please try other dates.`);
    }

    const reservation = await this.reservations.createReservation(
      {
        status: 'PENDING',
        contact_id: contact.id,
        room_id: chosen.id,
        check_in_date: dto.check_in,
        check_out_date: dto.check_out,
        notes: `Website booking · ${dto.guests} guest(s)`,
      },
      actorMeta,
    );

    const pricing = await this.reservations.priceReservation(reservation.id);

    return {
      confirmation_code: `LSP-${reservation.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
      reservation_id: reservation.id,
      guest_name: contact.name,
      unit_code: chosen.code,
      unit_name: chosen.name,
      unit_type: dto.unit_type,
      check_in: reservation.check_in_date,
      check_out: reservation.check_out_date,
      guests: dto.guests,
      pricing,
    };
  }
}
