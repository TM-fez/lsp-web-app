import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../../db/types.js';

// Entities kept out of a shared "what's happening" feed: session plumbing, which is
// noise, and staff pay, which is nobody else's business. The feed never renders the
// diff, so no figure leaked — but "Tumelo updated a record" against staff_compensation
// still tells the whole team that somebody's salary was touched, and by whom.
// (2026-10-04) A password change is equally personal — and says nothing to the team.
const HIDE = ['auth_login', 'refresh_token', 'staff_compensation', 'user_password'];

// entity_id is TEXT, not UUID (migration 009), so it cannot be cast blindly — one
// non-uuid row would fail the whole query and blank the feed. Guarded here instead.
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const FIRST_CHUNK = 200;
const MAX_CHUNK = 3200;
// Hard ceiling on audit rows examined for one request (200+400+...+3200+3200 ≈ 9.4k, about
// 200 ms in the worst case of a property with no recent activity at all).
const MAX_SCANNED = 8000;

export interface ActivityViewer {
  /** null only for the internal "no viewer" call, which behaves like an every-property user. */
  userId: string | null;
  allProperties: boolean;
}

interface ChunkRow extends ActivityRow {
  visible: boolean;
  chunk_size: string | number;
  cursor_ts: string;
}

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
   * (Round 4) "Global" now means "visible to people who can see every property, plus the
   * person who did it" — see ActivityViewer. Leads are mapped to their own property.
   *
   * Known and accepted: an audit row whose entity has been HARD-deleted resolves to NULL
   * and so reads as global. Soft deletes are unaffected — the subqueries deliberately do
   * not filter `deleted_at`, so removing a unit does not erase its history from the feed.
   * Hard deletes are rare by design ("soft delete everywhere"), and the row that survives
   * carries a phrase and an actor, never the entity's detail. Hiding it instead would mean
   * the feed quietly loses history, which is the worse trade.
   *
   * `viewer` (round 4): `allProperties` (admin, or a member of every property) keeps the
   * long-standing behaviour — a row that belongs to no property is house-wide and visible. A
   * user limited to some properties sees such a row only if THEY did it: rate plans, staff
   * accounts, company-level costs, unfiled files and the like are not theirs to read.
   */
  async recent(
    limit = 30,
    propertyId?: string,
    viewer: ActivityViewer = { userId: null, allProperties: true }
  ): Promise<ActivityRow[]> {
    // (Round 4, perf) The property of a row is resolved through correlated sub-selects, which
    // used to run for EVERY audit row before ORDER BY ... LIMIT — a full scan (~1.2 s at 100k
    // rows). Now the newest rows are taken in small, index-ordered CHUNKS and the resolution
    // runs only on each chunk; chunks grow until `limit` rows match, the audit log is
    // exhausted, or MAX_SCANNED rows have been looked at (the feed is "recent", so a property
    // with no activity in the last ~9k changes simply shows what it has).
    //
    // JIT is switched off for this read. The property-resolving CASE is a huge expression, so
    // Postgres' cost model crosses jit_above_cost and compiles it: ~1.7 s of LLVM work to
    // evaluate ~1,600 rows (measured). Without JIT the same chunk runs in a few milliseconds.
    // SET LOCAL lasts only for this transaction.
    return this.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL jit = off`.execute(trx);
      return this.collect(trx, limit, propertyId, viewer);
    });
  }

  private async collect(
    trx: Transaction<Database>,
    limit: number,
    propertyId: string | undefined,
    viewer: ActivityViewer
  ): Promise<ActivityRow[]> {
    const out: ActivityRow[] = [];
    let scanned = 0;
    let chunk = FIRST_CHUNK;
    let cursor: { ts: string; id: string } | null = null;

    while (out.length < limit && scanned < MAX_SCANNED) {
      const rows: ChunkRow[] = (await this.chunk(trx, chunk, cursor, propertyId, viewer)).rows;
      if (rows.length === 0) break;
      const last = rows[rows.length - 1]!;
      const examined = Number(last.chunk_size);
      for (const r of rows) {
        if (r.visible && out.length < limit) {
          const { visible: _v, chunk_size: _c, cursor_ts: _t, ...row } = r;
          out.push(row);
        }
      }
      scanned += examined;
      if (examined < chunk) break; // the audit log is exhausted
      cursor = { ts: last.cursor_ts, id: last.id };
      chunk = Math.min(chunk * 2, MAX_CHUNK);
    }
    return out;
  }

  /** One slice of the audit log, newest first, strictly older than `cursor`. */
  private chunk(
    exec: Transaction<Database>,
    size: number,
    cursor: { ts: string; id: string } | null,
    propertyId: string | undefined,
    viewer: ActivityViewer
  ) {
    const pid = propertyId ?? null;
    const before = cursor
      ? sql`AND (a.created_at, a.id) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`
      : sql``;
    // The resolved property of a row; NULL = belongs to no property ("global").
    const resolved = sql`
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
                -- its reservation — or (migration 071) off an invoice settled with no hold,
                -- which knows its booking. The invoice half used to resolve to nothing, so
                -- every Invoices-page settlement showed in every property's feed.
                WHEN 'payment_intents' THEN
                  (SELECT b.property_id FROM payment_intents pi
                     LEFT JOIN holds h ON h.id = pi.hold_id
                     LEFT JOIN invoices pinv ON pinv.id = pi.invoice_id
                     JOIN rooms rm ON rm.id = coalesce(
                       h.room_id,
                       (SELECT res.room_id FROM reservations res WHERE res.id = coalesce(h.reservation_id, pinv.reservation_id)))
                     JOIN buildings b ON b.id = rm.building_id WHERE pi.id = s.eid)
                -- (Owner decision 2026-10-04) A guest belongs to the properties they have
                -- booked at. Booked here → this property; booked only elsewhere → a value
                -- that never matches (so another property's guest stays out); never booked
                -- → global, like the guest list (core/scope/contactScope.ts).
                WHEN 'contacts' THEN
                  (SELECT CASE
                            WHEN bool_or(b.property_id = ${pid}::uuid) THEN ${pid}::uuid
                            ELSE '00000000-0000-0000-0000-000000000000'::uuid
                          END
                     FROM reservations r
                     JOIN rooms rm ON rm.id = r.room_id
                     JOIN buildings b ON b.id = rm.building_id
                    WHERE (r.contact_id = s.eid OR r.billing_contact_id = s.eid) AND r.deleted_at IS NULL
                   HAVING count(*) > 0)
                -- (Round 4, migration 082) An enquiry belongs to its property, if it has one.
                WHEN 'leads' THEN
                  (SELECT l.property_id FROM leads l WHERE l.id = s.eid)
                WHEN 'buildings' THEN
                  (SELECT bl.property_id FROM buildings bl WHERE bl.id = s.eid)
                WHEN 'properties' THEN s.eid
                -- Nullable by design: a payroll posting carries no property.
                WHEN 'operating_expense' THEN
                  (SELECT oe.property_id FROM operating_expenses oe WHERE oe.id = s.eid)
                ELSE NULL
              END
    `;
    return sql<ChunkRow>`
      WITH src AS (
        SELECT a.id, a.action, a.entity, a.entity_id, a.diff, a.created_at, a.user_id,
               a.created_at::text AS cursor_ts,
               CASE WHEN a.entity_id ~ ${UUID_RE} THEN a.entity_id::uuid END AS eid
        FROM audit_logs a
        WHERE a.entity <> ALL(${sql.val(HIDE)}::text[]) ${before}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${size}
      ),
      scored AS (
        SELECT s.*,
               u.name AS actor_name,
               row_number() OVER (ORDER BY s.created_at DESC, s.id DESC) AS rn,
               count(*) OVER () AS chunk_size,
               CASE
                 WHEN ${pid}::uuid IS NULL THEN true
                 ELSE (
                   SELECT CASE
                            WHEN r.pid IS NOT NULL THEN r.pid = ${pid}::uuid
                            ELSE ${viewer.allProperties} OR s.user_id = ${viewer.userId}::uuid
                          END
                   FROM (SELECT ${resolved} AS pid) r
                 )
               END AS visible
        FROM src s
        LEFT JOIN users u ON u.id = s.user_id
      )
      SELECT id, action, entity, entity_id, diff, created_at, actor_name, cursor_ts, chunk_size, visible
      FROM scored
      WHERE visible OR rn = chunk_size
      ORDER BY created_at DESC, id DESC
    `.execute(exec);
  }
}
