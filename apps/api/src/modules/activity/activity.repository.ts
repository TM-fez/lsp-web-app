import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/types.js';

// Entities kept out of a shared "what's happening" feed: session plumbing, which is
// noise, and staff pay, which is nobody else's business. The feed never renders the
// diff, so no figure leaked — but "Tumelo updated a record" against staff_compensation
// still tells the whole team that somebody's salary was touched, and by whom.
const HIDE = ['auth_login', 'refresh_token', 'staff_compensation'];

// entity_id is TEXT, not UUID (migration 009), so it cannot be cast blindly — one
// non-uuid row would fail the whole query and blank the feed. Guarded here instead.
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export interface ActivityRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string;
  diff: unknown;
  created_at: Date;
  actor_name: string | null;
}

export class ActivityRepository {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * The recent feed, scoped to one property (defect D03).
   *
   * `audit_logs` carries no property column — unlike the money paths, which were scoped
   * in H5 — so a Village user was reading CBD's activity. Adding the column would mean
   * threading a property through every audit write in 28 modules and would still say
   * nothing about the rows already written, so the property is resolved at READ time by
   * walking each entity back down its own chain to a building.
   *
   * `coalesce(resolved, :propertyId) = :propertyId` is the whole rule: a row that
   * resolves to a property must match, and a row that resolves to nothing is global and
   * stays visible to everyone. Guests, leads, rate plans and staff accounts are
   * house-wide and genuinely belong in every property's feed; a booking or a repair does
   * not. An entity nobody has mapped yet falls into "global" rather than disappearing —
   * a feed that silently drops rows is the failure mode this whole audit was about.
   *
   * Known and accepted: an audit row whose entity has been HARD-deleted resolves to NULL
   * and so reads as global. Soft deletes are unaffected — the subqueries deliberately do
   * not filter `deleted_at`, so removing a unit does not erase its history from the feed.
   * Hard deletes are rare by design ("soft delete everywhere"), and the row that survives
   * carries a phrase and an actor, never the entity's detail. Hiding it instead would mean
   * the feed quietly loses history, which is the worse trade.
   */
  async recent(limit = 30, propertyId?: string): Promise<ActivityRow[]> {
    const rows = await sql<ActivityRow>`
      WITH src AS (
        SELECT a.id, a.action, a.entity, a.entity_id, a.diff, a.created_at, a.user_id,
               CASE WHEN a.entity_id ~ ${UUID_RE} THEN a.entity_id::uuid END AS eid
        FROM audit_logs a
        WHERE a.entity <> ALL(${sql.val(HIDE)}::text[])
      )
      SELECT s.id, s.action, s.entity, s.entity_id, s.diff, s.created_at, u.name AS actor_name
      FROM src s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE ${propertyId ?? null}::uuid IS NULL
         OR coalesce(
              CASE s.entity
                WHEN 'reservations' THEN
                  (SELECT b.property_id FROM reservations r
                     JOIN rooms rm ON rm.id = r.room_id
                     JOIN buildings b ON b.id = rm.building_id WHERE r.id = s.eid)
                WHEN 'rooms' THEN
                  (SELECT b.property_id FROM rooms rm
                     JOIN buildings b ON b.id = rm.building_id WHERE rm.id = s.eid)
                -- entity_id on a collision is the ROOM it happened in, not a reservation.
                WHEN 'channel_collision' THEN
                  (SELECT b.property_id FROM rooms rm
                     JOIN buildings b ON b.id = rm.building_id WHERE rm.id = s.eid)
                WHEN 'housekeeping_tasks' THEN
                  (SELECT b.property_id FROM housekeeping_tasks t
                     JOIN rooms rm ON rm.id = t.room_id
                     JOIN buildings b ON b.id = rm.building_id WHERE t.id = s.eid)
                WHEN 'maintenance_work_orders' THEN
                  (SELECT b.property_id FROM maintenance_work_orders w
                     JOIN rooms rm ON rm.id = w.room_id
                     JOIN buildings b ON b.id = rm.building_id WHERE w.id = s.eid)
                -- A repair cost is audited against the work order it sits on.
                WHEN 'maintenance_expense' THEN
                  (SELECT b.property_id FROM maintenance_work_orders w
                     JOIN rooms rm ON rm.id = w.room_id
                     JOIN buildings b ON b.id = rm.building_id WHERE w.id = s.eid)
                WHEN 'occupancy' THEN
                  (SELECT b.property_id FROM occupancy o
                     JOIN rooms rm ON rm.id = o.room_id
                     JOIN buildings b ON b.id = rm.building_id WHERE o.id = s.eid)
                WHEN 'holds' THEN
                  (SELECT b.property_id FROM holds h
                     JOIN rooms rm ON rm.id = h.room_id
                     JOIN buildings b ON b.id = rm.building_id WHERE h.id = s.eid)
                WHEN 'invoices' THEN
                  (SELECT b.property_id FROM invoices i
                     JOIN reservations r ON r.id = i.reservation_id
                     JOIN rooms rm ON rm.id = r.room_id
                     JOIN buildings b ON b.id = rm.building_id WHERE i.id = s.eid)
                -- An intent hangs off a hold, which knows the room directly or through
                -- its reservation.
                WHEN 'payment_intents' THEN
                  (SELECT b.property_id FROM payment_intents pi
                     JOIN holds h ON h.id = pi.hold_id
                     JOIN rooms rm ON rm.id = coalesce(
                       h.room_id, (SELECT res.room_id FROM reservations res WHERE res.id = h.reservation_id))
                     JOIN buildings b ON b.id = rm.building_id WHERE pi.id = s.eid)
                WHEN 'buildings' THEN
                  (SELECT bl.property_id FROM buildings bl WHERE bl.id = s.eid)
                WHEN 'properties' THEN s.eid
                -- Nullable by design: a payroll posting carries no property.
                WHEN 'operating_expense' THEN
                  (SELECT oe.property_id FROM operating_expenses oe WHERE oe.id = s.eid)
                ELSE NULL
              END,
              ${propertyId ?? null}::uuid
            ) = ${propertyId ?? null}::uuid
      ORDER BY s.created_at DESC
      LIMIT ${limit}
    `.execute(this.db);

    return rows.rows;
  }
}
