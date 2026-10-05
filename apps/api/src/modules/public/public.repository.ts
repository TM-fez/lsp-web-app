import { Kysely, sql } from 'kysely';
import type { Database, ContactRow } from '../../db/types.js';
import { propertyToday } from '../../core/time.js';
import type { UnitType } from '../pricing/pricing.types.js';
import type { PublicPropertyOption, StayUnitOption } from './public.types.js';

export class PublicRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /** Active properties for the public enquiry form — names only. */
  async activeProperties(): Promise<PublicPropertyOption[]> {
    return this.db
      .selectFrom('properties')
      .select(['id', 'name'])
      .where('active', '=', true)
      .orderBy('name', 'asc')
      .execute();
  }

  /**
   * The actor a website booking is attributed to (created_by / audit). Web
   * bookings have no logged-in user, so they're stamped to the oldest account
   * (the system admin) — a valid users.id, which the FK requires.
   */
  async systemActorId(): Promise<string> {
    const row = await this.db
      .selectFrom('users')
      .select('id')
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
    if (!row) throw new Error('No system user to attribute website bookings to');
    return row.id;
  }

  async activePlans(): Promise<StayUnitOption[]> {
    const rows = await this.db
      .selectFrom('rate_plans')
      .select(['unit_type', 'name', 'nightly_rate', 'deposit_pct', 'max_guests', 'min_nights', 'currency'])
      .where('active', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('nightly_rate', 'asc')
      .execute();
    return rows.map((r) => ({
      unit_type: r.unit_type,
      name: r.name,
      nightly_rate: r.nightly_rate,
      deposit_pct: r.deposit_pct,
      max_guests: r.max_guests,
      min_nights: r.min_nights,
      currency: r.currency,
    }));
  }

  async findContactByEmail(email: string): Promise<ContactRow | undefined> {
    return this.db
      .selectFrom('contacts')
      .selectAll()
      // Exact, case-insensitive — NOT `ilike`: in a LIKE pattern `_` and `%` are wildcards,
      // and both are legal in an email address, so `__@x.com` matched any 2-letter mailbox.
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * A guest's own website booking, by confirmation-code prefix + booking email.
   * The code is the first 6 hex chars of the reservation id (see createBooking's
   * confirmation_code); BOTH must match, and only WEBSITE bookings resolve —
   * staff/OTA bookings are not guest-lookupable.
   */
  async findWebsiteBookingByCode(codeHex: string, email: string) {
    return this.db
      .selectFrom('reservations as res')
      .innerJoin('contacts as c', 'c.id', 'res.contact_id')
      .innerJoin('rooms as r', 'r.id', 'res.room_id')
      .select([
        'res.id',
        'res.status',
        'res.check_in_date',
        'res.check_out_date',
        'c.name as guest_name',
        'r.name as unit_name',
        'r.type as unit_type',
      ])
      .where(sql<boolean>`replace(res.id::text, '-', '') ilike ${codeHex + '%'}`)
      .where('res.source', '=', 'WEBSITE')
      .where('res.deleted_at', 'is', null)
      // Exact email match (see findContactByEmail): with `ilike`, `_`/`%` in the typed
      // email were wildcards, so a pattern plus a guessed 6-hex code returned a stranger's
      // booking — the code alone is only 16M guesses wide.
      .where(sql<boolean>`lower(c.email) = lower(${email})`)
      .executeTakeFirst();
  }

  /** Resolve an in-apartment QR token to its unit + property (no guest PII). */
  async roomByGuestToken(token: string) {
    return this.db
      .selectFrom('rooms as r')
      .innerJoin('buildings as b', 'b.id', 'r.building_id')
      .innerJoin('properties as p', 'p.id', 'b.property_id')
      .select(['r.id as room_id', 'r.name as unit_name', 'r.code as unit_code', 'p.name as property_name'])
      .where('r.guest_qr_token', '=', token)
      .where('r.deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * The stay to attach a self check-in to: the guest physically in this unit today.
   * Prefer an in-house occupancy, else a reservation whose window covers today.
   * BLOCKED is included so an un-claimed OTA guest can still hand over their details.
   */
  async currentStayForRoom(roomId: string) {
    const today = propertyToday();
    return this.db
      .selectFrom('reservations as res')
      .leftJoin('occupancy as o', (join) =>
        join.onRef('o.reservation_id', '=', 'res.id').on('o.status', '=', 'CHECKED_IN').on('o.deleted_at', 'is', null),
      )
      .select(['res.id as reservation_id', 'res.contact_id', 'res.check_out_date', 'res.self_checkin_at'])
      .where('res.room_id', '=', roomId)
      .where('res.deleted_at', 'is', null)
      .where('res.status', 'in', ['CONFIRMED', 'CHECKED_IN', 'BLOCKED'])
      .where(sql<boolean>`res.check_in_date <= ${today}`)
      .where(sql<boolean>`res.check_out_date >= ${today}`)
      .orderBy(sql`(o.id is not null)`, 'desc') // checked-in first
      .orderBy('res.check_in_date', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /** Stamp that the guest confirmed their details from the apartment. */
  /**
   * (Re-test round 3) Record a guest's in-room self check-in.
   *
   * The QR page used to OVERWRITE the booked guest's name, email and phone with whatever
   * was typed — no login, just a QR code on the wall. A later guest, a visitor or a typo
   * could replace a real guest's contact details. Now it only FILLS what is missing:
   *   - email / phone are written only where the contact has none;
   *   - the name is replaced only on an anonymous contact (no email AND no phone — the
   *     "Booking.com Guest" placeholder this feature exists to enrich);
   *   - anything that differs from details already on file is not applied but noted on
   *     the booking, for staff to check.
   * One transaction with its audit rows; the self check-in stamp is audited too.
   */
  async recordSelfCheckin(
    reservationId: string,
    contactId: string,
    submitted: { name: string; email: string; phone?: string | null },
    meta: { userId: string; ip?: string; requestId?: string }
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const contact = await trx
        .selectFrom('contacts')
        .select(['name', 'email', 'phone'])
        .where('id', '=', contactId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const anonymous = !contact.email && !contact.phone;
      const patch: { name?: string; email?: string; phone?: string } = {};
      const differs: string[] = [];
      if (anonymous) {
        if (submitted.name && submitted.name !== contact.name) patch.name = submitted.name;
      } else if (submitted.name && submitted.name.trim().toLowerCase() !== contact.name.trim().toLowerCase()) {
        differs.push(`name “${submitted.name}”`);
      }
      if (!contact.email) patch.email = submitted.email;
      else if (submitted.email.toLowerCase() !== contact.email.toLowerCase()) differs.push(`email ${submitted.email}`);
      if (submitted.phone) {
        if (!contact.phone) patch.phone = submitted.phone;
        else if (submitted.phone.replace(/\s/g, '') !== contact.phone.replace(/\s/g, '')) differs.push(`phone ${submitted.phone}`);
      }

      if (Object.keys(patch).length > 0) {
        await trx
          .updateTable('contacts')
          .set({ ...patch, updated_by: meta.userId, updated_at: sql`now()` })
          .where('id', '=', contactId)
          .execute();
        await trx.insertInto('audit_logs').values({
          request_id: meta.requestId ?? null,
          user_id: meta.userId,
          action: 'UPDATE',
          entity: 'contacts',
          entity_id: contactId,
          diff: { ...patch, source: 'guest self check-in (filled blanks only)' },
          ip_address: meta.ip ?? null,
        }).execute();
      }

      const note = differs.length
        ? `Guest self check-in gave different details — not applied, please check: ${differs.join(', ')}.`
        : null;
      await trx
        .updateTable('reservations')
        .set({
          self_checkin_at: sql`now()`,
          ...(note ? { notes: sql`concat_ws(E'\n', nullif(notes, ''), ${note}::text)` } : {}),
          updated_by: meta.userId,
          updated_at: sql`now()`,
        })
        .where('id', '=', reservationId)
        .execute();
      await trx.insertInto('audit_logs').values({
        request_id: meta.requestId ?? null,
        user_id: meta.userId,
        action: 'UPDATE',
        entity: 'reservations',
        entity_id: reservationId,
        diff: { self_checkin: true, ...(note ? { note } : {}) },
        ip_address: meta.ip ?? null,
      }).execute();
    });
  }

  /** Active units of a type that could take a booking (excludes maintenance / out-of-service). */
  async bookableRoomsByType(unitType: UnitType): Promise<Array<{ id: string; code: string; name: string }>> {
    return this.db
      .selectFrom('rooms')
      .select(['id', 'code', 'name'])
      .where('type', '=', unitType)
      .where('deleted_at', 'is', null)
      .where('status', 'not in', ['MAINTENANCE', 'OUT_OF_SERVICE'])
      .orderBy('code', 'asc')
      .execute();
  }
}
