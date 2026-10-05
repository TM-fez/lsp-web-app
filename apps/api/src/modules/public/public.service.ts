import { PublicRepository } from './public.repository.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { ContactsRepository } from '../crm/contacts/contacts.repository.js';
import { LeadsRepository } from '../crm/leads/leads.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import { env } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import { sendEmail, isEmailConfigured } from '../../core/email/email.service.js';
import type { CreateBookingDTO, LookupBookingDTO, PublicBookingSummary, PublicRequestMeta, StayUnitOption, SelfCheckinDTO, GuestCheckinInfo, CreateEnquiryDTO, EnquiryConfirmation, PublicPropertyOption } from './public.types.js';
import type { UnitType } from '../pricing/pricing.types.js';
import type { CRMRequestMeta } from '../crm/crm.types.js';

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
    private readonly leads: LeadsRepository,
  ) {}

  /**
   * Public enquiry capture: file a NEW lead so a website/WhatsApp enquiry is always
   * tracked, and find-or-create a CRM contact when an email is given (so it can feed
   * segmentation and a later convert-to-booking). Attributed to the system actor.
   */
  async createEnquiry(dto: CreateEnquiryDTO, meta: PublicRequestMeta): Promise<EnquiryConfirmation> {
    const actorId = await this.repository.systemActorId();
    const actorMeta = { userId: actorId, ip: meta.ip, requestId: meta.requestId };

    // Link a contact only when we have an email to dedupe on (avoids a pile of
    // near-duplicate contacts from anonymous enquiries).
    let contactId: string | null = null;
    if (dto.email) {
      // (Small improvements, from R7) Typing someone else's email filed the enquiry under
      // THEM. As for a booking (R6), the existing guest is used only when it is plainly the
      // same person — the same phone, or the same name when no phone was given. Otherwise a
      // new record, noted for staff as a possible duplicate (it shares the email).
      const existing = await this.repository.findContactByEmail(dto.email);
      const samePerson = !!existing && (dto.phone
        ? digitsOf(existing.phone) !== '' && digitsOf(existing.phone) === digitsOf(dto.phone)
        : existing.name.trim().toLowerCase() === dto.name.trim().toLowerCase());
      contactId = samePerson
        ? existing!.id
        : (await this.contacts.create(
            {
              type: 'individual',
              name: dto.name,
              email: dto.email,
              phone: dto.phone ?? null,
              notes: existing
                ? 'Created from a website enquiry — possible duplicate: another guest already uses this email. Check before merging.'
                : 'Created from a website enquiry',
              ...(existing ? { email_shared: true } : {}),
              created_by: actorId,
              updated_by: actorId,
            },
            actorMeta,
          )).id;
    }

    // (R5 decision, 2026-10-04) A website enquiry used to land with no property, so staff
    // limited to one property never saw it and only an all-property manager could route
    // it. The form now asks which property; with only one active property there is
    // nothing to ask, so it is filed there. "Not sure" (no id) stays unassigned on purpose
    // — guessing would hide it from the property it is really for.
    const properties = await this.repository.activeProperties();
    let propertyId: string | null = null;
    if (dto.property_id) {
      if (!properties.some((p) => p.id === dto.property_id)) {
        throw AppError.badRequest('Please choose one of our properties, or “Not sure”.');
      }
      propertyId = dto.property_id;
    } else if (properties.length === 1) {
      propertyId = properties[0]!.id;
    }

    const summary = dto.message.length > 180 ? `${dto.message.slice(0, 179)}…` : dto.message;
    const who = [dto.name, dto.email, dto.phone].filter(Boolean).join(' · ');

    const lead = await this.leads.create(
      {
        title: summary,
        description: `${who}\n\n${dto.message}`,
        status: 'NEW',
        source: dto.source,
        phone: dto.phone ?? null,
        contact_id: contactId,
        property_id: propertyId,
        created_by: actorId,
        updated_by: actorId,
      },
      actorMeta,
    );

    return { reference: `ENQ-${lead.id.replace(/-/g, '').slice(0, 6).toUpperCase()}` };
  }

  /** Properties the enquiry form offers (names only). */
  async getEnquiryProperties(): Promise<{ properties: PublicPropertyOption[] }> {
    return { properties: await this.repository.activeProperties() };
  }

  /** Bookable layouts + from-prices for the public site. No PII, no availability. */
  async getStayInfo(): Promise<{ units: StayUnitOption[] }> {
    return { units: await this.repository.activePlans() };
  }

  /**
   * Create a booking request from the public site: find/create the guest, find a
   * free unit of the requested type, and create a PENDING reservation (the same
   * money-loop invariant — only payment confirms it). Returns a confirmation.
   */
  /** (R6 NEW-5) The guest record a website booking belongs to — see createBooking. */
  private async resolveContact(
    dto: CreateBookingDTO,
    actorId: string,
    actorMeta: CRMRequestMeta
  ): Promise<{ id: string }> {
    const existing = await this.repository.findContactByEmail(dto.email);
    const samePerson = !!existing && !!dto.phone && digitsOf(existing.phone) !== '' && digitsOf(existing.phone) === digitsOf(dto.phone);
    if (samePerson) return existing!;
    return this.contacts.create(
      {
        type: 'individual',
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        notes: existing
          ? 'Created from a website booking — possible duplicate: another guest already uses this email. Check before merging.'
          : 'Created from a website booking',
        // Not a new owner of the email — a second record that shares it (migration 089).
        ...(existing ? { email_shared: true } : {}),
        created_by: actorId,
        updated_by: actorId,
      },
      actorMeta,
    );
  }

  async createBooking(dto: CreateBookingDTO, meta: PublicRequestMeta) {
    // Refuse a layout we can't price BEFORE writing anything. With no active rate plan
    // (or a zero rate) the booking used to be created anyway — a P0 stay holding a real
    // unit, which then publishes to Booking.com as busy (invariant 7).
    const plan = (await this.repository.activePlans()).find((p) => p.unit_type === dto.unit_type);
    if (!plan || plan.nightly_rate <= 0) {
      throw AppError.badRequest(
        `${unitLabel(dto.unit_type)} bookings aren’t open online right now. Please send us an enquiry instead.`,
      );
    }

    const actorId = await this.repository.systemActorId();
    const actorMeta = { userId: actorId, ip: meta.ip, requestId: meta.requestId };

    // (R6 NEW-5, privacy) Which guest record does this booking belong to?
    //
    // This page is public. Matching on email alone attached the booking to whoever already
    // owned that email and echoed THEIR stored name back — anyone could find out who an
    // email belongs to — and silently dropped the name and phone that were typed. Now the
    // existing record is reused only when email AND phone both match (the same person
    // coming back). Otherwise a new record is made from what was typed and flagged as a
    // possible duplicate for staff to check; nothing about the existing guest leaks.
    // (R7 N7-2) Two bookings with the same NEW email at once both see "nobody has it"; one
    // saves and the other hits the one-live-email rule (migration 089). The loser looks
    // again and carries on as if the first had been there all along — a reused record or
    // a flagged duplicate — instead of answering a guest with a generic clash.
    let contact: { id: string };
    try {
      contact = await this.resolveContact(dto, actorId, actorMeta);
    } catch (err) {
      if (!isEmailTaken(err)) throw err;
      contact = await this.resolveContact(dto, actorId, actorMeta);
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

    // A website booking creates money OWED, so it must exist as a receivable from the
    // first moment: agree the price and raise the open invoice now. Without it Finance
    // sees nothing until someone happens to record a payment. Best-effort — the guest's
    // booking stands whether or not the books could be updated (it self-heals at
    // check-in/check-out and the backfill reconciles any that missed). If the guest never
    // pays, the 24h expiry cancels the booking and voids the invoice with it.
    try {
      await this.reservations.ensureReceivable(reservation.id, actorMeta);
    } catch (err) {
      logger.error({ err, reservationId: reservation.id }, '[public] booking created but its invoice could not be raised');
    }

    const pricing = await this.reservations.priceReservation(reservation.id);

    const confirmation = {
      confirmation_code: `LSP-${reservation.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
      reservation_id: reservation.id,
      // Always the name the caller typed — never a stored one (R6 NEW-5).
      guest_name: dto.name,
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

    // Fill in what is missing — never overwrite a guest's details from an unauthenticated
    // page (see PublicRepository.recordSelfCheckin).
    await this.repository.recordSelfCheckin(
      stay.reservation_id,
      stay.contact_id,
      { name: dto.name, email: dto.email, phone: dto.phone ?? null },
      actorMeta,
    );

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

/** Phone numbers compared by their digits only: "+267 71 234 567" = "+26771234567". */
/** The one-live-email rule (migration 089) refused this save — someone just took the email. */
function isEmailTaken(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && e?.constraint === 'contacts_email_unique';
}

/**
 * The number as international digits, for "is this the same phone?" — the same rule the
 * web's WhatsApp/Call buttons use. A guest typing "071 234 567" on the website is the same
 * person as "+267 71 234 567" on file; comparing bare digits missed that and made a
 * second, flagged record. Botswana (+267) is assumed for a number written locally; a
 * "+"/"00" number is already international. Empty when there is no number.
 */
function digitsOf(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('267') && digits.length > 9) return digits;
  return '267' + digits.replace(/^0+/, '');
}
