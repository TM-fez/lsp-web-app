import { sql, type RawBuilder } from 'kysely';

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
