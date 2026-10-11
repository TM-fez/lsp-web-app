import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Database } from '../../db/types.js';
import { AppError } from '../errors/AppError.js';

/**
 * (Owner decision 2026-10-04) Which guests a property-limited user may see.
 *
 * Guests (`contacts`) were house-wide on purpose: a customer is a customer across the
 * estate. The owner decided otherwise for staff tied to one property — a CBD manager
 * should not read the Village guest book (names, phones, emails). A contact is visible to
 * someone whose access is limited to `propertyIds` when ANY of:
 *   - it has a booking (as guest or as billing contact) at one of those properties;
 *   - it has no booking anywhere yet — an enquiry or a just-created guest belongs to no
 *     property, and hiding it would stop staff booking the person they just added;
 *   - they created it themselves.
 * `propertyIds === null` means every property (admin) — no filter.
 *
 * One SQL fragment so the guest list, a guest by id, the marketing segments and the
 * activity feed all apply exactly the same rule. `alias` is the contacts table alias.
 */
export function contactVisibleSql(
  alias: string,
  propertyIds: string[] | null,
  userId: string
): RawBuilder<boolean> {
  if (propertyIds === null) return sql<boolean>`true`;
  const c = sql.ref(alias);
  const booked = sql`
    SELECT 1 FROM reservations cr
      JOIN rooms crm ON crm.id = cr.room_id
      JOIN buildings cb ON cb.id = crm.building_id
     WHERE (cr.contact_id = ${c}.id OR cr.billing_contact_id = ${c}.id)
       AND cr.deleted_at IS NULL`;
  const inMine =
    propertyIds.length === 0
      ? sql<boolean>`false`
      : sql<boolean>`EXISTS (${booked} AND cb.property_id IN (${sql.join(propertyIds)}))`;
  return sql<boolean>`(
    ${inMine}
    OR NOT EXISTS (
      SELECT 1 FROM reservations cr2
       WHERE (cr2.contact_id = ${c}.id OR cr2.billing_contact_id = ${c}.id) AND cr2.deleted_at IS NULL
    )
    OR ${c}.created_by = ${userId}
  )`;
}

/** Who is linking a guest: their id and the properties they are limited to (null = all). */
export interface ContactViewer {
  userId: string;
  propertyIds: string[] | null;
}

/**
 * (Audit 2026-10-11, H-2) Every id in `contactIds` must be a live contact this viewer may see.
 *
 * Linking a guest is a way of SEEING one: once a contact is the guest or billing contact on a
 * booking at your property, `contactVisibleSql` counts it as yours. Writers only checked that
 * the id existed, so a CBD-only user who learned a Village guest's id could put it on a CBD
 * booking and then open the full record. A contact you can't see now answers exactly like one
 * that doesn't exist (`notFoundMessage`), so the check never confirms the id is real.
 */
export async function assertContactsVisible(
  db: Kysely<Database>,
  contactIds: ReadonlyArray<string | null | undefined>,
  viewer: ContactViewer,
  notFoundMessage: string
): Promise<void> {
  const ids = [...new Set(contactIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const rows = await db
    .selectFrom('contacts')
    .select('id')
    .where('id', 'in', ids)
    .where('deleted_at', 'is', null)
    .where(contactVisibleSql('contacts', viewer.propertyIds, viewer.userId))
    .execute();
  if (rows.length !== ids.length) throw AppError.badRequest(notFoundMessage);
}
