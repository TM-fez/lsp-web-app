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
          // Drop the scan bookkeeping columns; the rest is the public row.
          const row: Partial<ChunkRow> = { ...r };
          delete row.visible;
          delete row.chunk_size;
          delete row.cursor_ts;
          out.push(row as ActivityRow);
        }
      }
      scanned += examined;
      if (examined < chunk) break; // the audit log is exhausted
      cursor = { ts: last.cursor_ts, id: last.id };
      chunk = Math.min(chunk * 2, MAX_CHUNK);
    }
    return out;
  }

  /**
   * One slice of the audit log, newest first, strictly older than `cursor`.
   *
   * (R5 retest, migration 088) Each row's property is stored when it is written
   * (`property_id` / `scope_kind`), so a property feed reads exactly two index-ordered
   * streams — that property's rows, and rows tied to no single property — instead of
   * resolving every row of every property on the fly. Only guests ('C') are still worked
   * out here: a guest belongs to every property they have booked at, which can change.
   */
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
    const cols = sql`a.id, a.action, a.entity, a.entity_id, a.diff, a.created_at, a.user_id,
               a.property_id, a.scope_kind, a.created_at::text AS cursor_ts,
               CASE WHEN a.entity_id ~ ${UUID_RE} THEN a.entity_id::uuid END AS eid`;
    const hide = sql`a.entity <> ALL(${sql.val(HIDE)}::text[])`;
    const order = sql`ORDER BY a.created_at DESC, a.id DESC LIMIT ${size}`;
    // No property in play (an all-property view): one stream, everything.
    const src = pid === null
      ? sql`SELECT ${cols} FROM audit_logs a WHERE ${hide} ${before} ${order}`
      : sql`SELECT * FROM (
              (SELECT ${cols} FROM audit_logs a
                WHERE a.scope_kind = 'P' AND a.property_id = ${pid}::uuid AND ${hide} ${before} ${order})
              UNION ALL
              (SELECT ${cols} FROM audit_logs a
                WHERE a.scope_kind <> 'P' AND ${hide} ${before} ${order})
            ) both_streams
            ORDER BY created_at DESC, id DESC LIMIT ${size}`;
    // (Owner decision 2026-10-04) A guest belongs to the properties they have booked at.
    // Booked here → visible; booked only elsewhere → never; never booked → global.
    const guestHere = sql`(SELECT CASE WHEN bool_or(b.property_id = ${pid}::uuid) THEN 'here' ELSE 'elsewhere' END
                             FROM reservations r
                             JOIN rooms rm ON rm.id = r.room_id
                             JOIN buildings b ON b.id = rm.building_id
                            WHERE (r.contact_id = s.eid OR r.billing_contact_id = s.eid) AND r.deleted_at IS NULL
                           HAVING count(*) > 0)`;
    const global = sql`(${viewer.allProperties} OR s.user_id = ${viewer.userId}::uuid)`;
    return sql<ChunkRow>`
      WITH src AS (${src}),
      scored AS (
        SELECT s.*,
               u.name AS actor_name,
               row_number() OVER (ORDER BY s.created_at DESC, s.id DESC) AS rn,
               count(*) OVER () AS chunk_size,
               CASE
                 WHEN ${pid}::uuid IS NULL THEN true
                 WHEN s.scope_kind = 'P' THEN s.property_id = ${pid}::uuid
                 WHEN s.scope_kind = 'C' THEN
                   CASE ${guestHere} WHEN 'here' THEN true WHEN 'elsewhere' THEN false ELSE ${global} END
                 ELSE ${global}
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
