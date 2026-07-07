import { PublicRepository } from './public.repository.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { ContactsRepository } from '../crm/contacts/contacts.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import { env } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import { sendEmail, isEmailConfigured } from '../../core/email/email.service.js';
import type { CreateBookingDTO, LookupBookingDTO, PublicBookingSummary, PublicRequestMeta, StayUnitOption, SelfCheckinDTO, GuestCheckinInfo } from './public.types.js';
import type { UnitType } from '../pricing/pricing.types.js';

const unitLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

// Date-only columns come back at local midnight; local components round-trip the day.
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
        source: 'WEBSITE',
        contact_id: contact.id,
        room_id: chosen.id,
        check_in_date: dto.check_in,
        check_out_date: dto.check_out,
        notes: `Website booking · ${dto.guests} guest(s)`,
      },
      actorMeta,
    );

    const pricing = await this.reservations.priceReservation(reservation.id);

    const confirmation = {
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

    // Fire-and-forget: the booking stands whether or not the email goes out.
    void this.sendConfirmationEmail(dto.email, confirmation).catch((err) =>
      logger.warn({ err, reservationId: reservation.id }, 'booking confirmation email failed'),
    );

    return confirmation;
  }

  /**
   * H6 — guest confirmation email with a "manage my booking" link. DARK until
   * email is configured (Brevo); the link section is omitted when PUBLIC_WEB_URL
   * is unset. Deliberately minimal HTML — this must render in any client.
   */
  private async sendConfirmationEmail(
    to: string,
    c: {
      confirmation_code: string;
      guest_name: string;
      unit_name: string;
      check_in: Date;
      check_out: Date;
      guests: number;
    },
  ): Promise<void> {
    if (!isEmailConfigured()) return;

    const manageUrl = env.PUBLIC_WEB_URL
      ? `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/stay/manage?code=${encodeURIComponent(c.confirmation_code)}&email=${encodeURIComponent(to)}`
      : null;

    await sendEmail({
      to,
      subject: `Booking request received — ${c.confirmation_code}`,
      html:
        `<p>Dear ${escapeHtml(c.guest_name)},</p>` +
        `<p>We received your booking request at <b>Lifestyle Apartments</b>:</p>` +
        `<ul>` +
        `<li>Confirmation code: <b>${escapeHtml(c.confirmation_code)}</b></li>` +
        `<li>Unit: ${escapeHtml(c.unit_name)}</li>` +
        `<li>Stay: ${day(c.check_in)} → ${day(c.check_out)} · ${c.guests} guest(s)</li>` +
        `</ul>` +
        `<p>Your booking is <b>pending</b> until our team confirms it — we will be in touch shortly.</p>` +
        (manageUrl
          ? `<p><a href="${manageUrl}">View or check the status of your booking</a></p>`
          : '') +
        `<p>Lifestyle Apartments, Gaborone</p>`,
    });
  }

  /**
   * In-apartment QR (Phase 5): read the unit's context for the check-in page.
   * Returns no PII of the current guest — only where they are and until when.
   */
  async getCheckinInfo(token: string): Promise<GuestCheckinInfo> {
    const room = await this.repository.roomByGuestToken(token);
    if (!room) throw AppError.notFound('That check-in code is not recognised.');
    const stay = await this.repository.currentStayForRoom(room.room_id);
    return {
      property_name: room.property_name,
      unit_name: room.unit_name,
      unit_code: room.unit_code,
      has_stay: Boolean(stay),
      check_out_date: stay ? day(stay.check_out_date) : null,
      already_checked_in: Boolean(stay?.self_checkin_at),
    };
  }

  /**
   * The guest hands over their own details from the apartment: enrich the stay's
   * CRM contact (so an anonymous OTA guest becomes re-bookable) and stamp the stay.
   * The trust boundary is physical access to the in-unit QR + a per-IP limit.
   */
  async submitSelfCheckin(dto: SelfCheckinDTO, meta: PublicRequestMeta): Promise<{ property_name: string; unit_name: string }> {
    const room = await this.repository.roomByGuestToken(dto.token);
    if (!room) throw AppError.notFound('That check-in code is not recognised.');
    const stay = await this.repository.currentStayForRoom(room.room_id);
    if (!stay) throw AppError.conflict('There is no active stay for this apartment right now.');

    const actorId = await this.repository.systemActorId();
    const actorMeta = { userId: actorId, ip: meta.ip, requestId: meta.requestId };

    // Fill in the guest's self-declared details (audit-logged by contacts.update).
    await this.contacts.update(
      stay.contact_id,
      { name: dto.name, email: dto.email, ...(dto.phone ? { phone: dto.phone } : {}), updated_by: actorId },
      actorMeta,
    );
    await this.repository.stampSelfCheckin(stay.reservation_id, actorId);

    return { property_name: room.property_name, unit_name: room.unit_name };
  }

  /** H6 — public manage-my-booking lookup (code + email must BOTH match). */
  async lookupBooking(dto: LookupBookingDTO): Promise<PublicBookingSummary> {
    const codeHex = dto.code.replace(/^LSP-/i, '').toLowerCase();
    const row = await this.repository.findWebsiteBookingByCode(codeHex, dto.email);
    if (!row || row.status === 'BLOCKED') {
      throw AppError.notFound('No booking matches that code and email');
    }
    return {
      confirmation_code: `LSP-${codeHex.toUpperCase()}`,
      guest_name: row.guest_name,
      status: row.status as PublicBookingSummary['status'],
      unit_name: row.unit_name,
      unit_type: unitLabel(row.unit_type),
      check_in: day(row.check_in_date),
      check_out: day(row.check_out_date),
    };
  }
}
