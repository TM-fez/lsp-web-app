import { sql } from 'kysely';

/**
 * The property an invoice belongs to, as ONE SQL expression, so the Invoices list and the
 * Finance cockpit can never resolve it two different ways again.
 *
 * They did: the list walked reservation → hold → room → building and treated an invoice
 * with no property as house-wide (visible everywhere), while the cockpit walked only
 * reservation → room → building and — for non-admins — dropped everything it could not
 * attribute. Same invoices, different totals, depending on who was looking and which
 * screen. Both now call this.
 *
 * Resolution order matches `propertyOfInvoice` (the by-id guard): the invoice's own
 * reservation's room, then its hold's room, then the room of the reservation behind its
 * hold. NULL when the chain ends nowhere — "Unattributed".
 *
 * @param alias the invoices table alias in the calling query (`invoices`, or `i`)
 */
export function invoicePropertyIdSql(alias = 'invoices') {
  const col = (c: string) => sql.ref(`${alias}.${c}`);
  return sql<string | null>`(
    select b.property_id from rooms r
    left join buildings b on b.id = r.building_id
    where r.id = coalesce(
      (select res.room_id from reservations res where res.id = ${col('reservation_id')}),
      (select h.room_id from holds h where h.id = ${col('hold_id')}),
      (select res2.room_id from holds h2
         join reservations res2 on res2.id = h2.reservation_id
       where h2.id = ${col('hold_id')})
    )
  )`;
}

/**
 * "This invoice is visible in `propertyId`": it resolves to that property, or to none at
 * all (house-wide / Unattributed invoices stay visible, and collectable, from every
 * property — the D03/H5 rule the by-id guard `requireInActivePropertyAllowUnattributed`
 * already applies). An invoice that resolves to a DIFFERENT property is never visible.
 */
export function invoiceVisibleInProperty(propertyId: string, alias = 'invoices') {
  return sql<boolean>`coalesce(${invoicePropertyIdSql(alias)}, ${propertyId}) = ${propertyId}`;
}
