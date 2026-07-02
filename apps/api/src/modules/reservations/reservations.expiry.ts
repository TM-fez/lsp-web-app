import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { db as defaultDb } from '../../config/db.js';
import { env } from '../../config/env.js';
import type { Database } from '../../db/types.js';
import { notifications as sharedNotifications } from '../notifications/notifications.routes.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Auto-expiry for unpaid website bookings.
 *
 * A /stay booking lands as a PENDING reservation with no hold behind it, and PENDING
 * participates in the reservations_no_overlap constraint — so an abandoned (or
 * malicious) website booking takes real nights off the market until someone notices.
 * Holds and quotes already expire on the sweep; this closes the same gap for the
 * hold-less public path: a WEBSITE-source reservation still PENDING after the TTL is
 * cancelled, audited, and the property is notified so staff can call the guest back.
 *
 * Staff-created PENDING bookings (DIRECT/WALK_IN/…) are deliberately untouched — an
 * operator parked those on purpose.
 */

export interface StaleWebsiteBooking {
  id: string;
  room_name: string;
  guest_name: string;
  property_id: string;
  check_in_date: Date;
  check_out_date: Date;
}

export interface ExpiryDeps {
  /** WEBSITE + PENDING + not deleted, created before the cutoff. */
  findStale(cutoff: Date): Promise<StaleWebsiteBooking[]>;
  /**
   * Cancel one booking iff it is STILL PENDING (guards the race against a
   * just-confirmed payment) and write the audit row. True when it cancelled.
   */
  cancel(id: string, actorId: string, ttlHours: number): Promise<boolean>;
  /** The actor cancellations are attributed to (same rule as website bookings). */
  systemActorId(): Promise<string>;
  notify: NotificationsService['notify'];
}

// Date-only columns come back from node-postgres as a JS Date at LOCAL midnight, so
// local components round-trip the calendar day on any server timezone (see channel.ical).
function fmtDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Expire every stale website booking once. Returns how many were cancelled. */
export async function expireStaleWebsiteBookings(
  deps: ExpiryDeps,
  ttlHours: number,
  now: Date = new Date(),
): Promise<number> {
  if (ttlHours <= 0) return 0; // 0 disables the sweep entirely

  const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
  const stale = await deps.findStale(cutoff);
  if (stale.length === 0) return 0;

  const actorId = await deps.systemActorId();
  let expired = 0;

  for (const b of stale) {
    // cancel() re-checks PENDING inside the UPDATE, so a booking confirmed between
    // the SELECT and here is left alone.
    const cancelled = await deps.cancel(b.id, actorId, ttlHours);
    if (!cancelled) continue;
    expired++;

    await deps.notify(
      { propertyId: b.property_id },
      {
        type: 'reservation.website_expired',
        title: `Website booking expired — ${b.room_name}`,
        body:
          `${b.guest_name}'s unconfirmed website booking for ${b.room_name} ` +
          `(${fmtDay(b.check_in_date)} → ${fmtDay(b.check_out_date)}) was auto-cancelled ` +
          `after ${ttlHours}h. The nights are sellable again — call the guest back if the stay is still wanted.`,
        entityType: 'reservations',
        entityId: b.id,
        link: `/reservations/${b.id}`,
        dedupKey: `reservation.website_expired:${b.id}`,
      },
    );
  }

  return expired;
}

// ── Real dependencies ─────────────────────────────────────────────────────────

function buildDeps(db: Kysely<Database>, service: NotificationsService): ExpiryDeps {
  return {
    async findStale(cutoff) {
      return db
        .selectFrom('reservations as r')
        .innerJoin('rooms as rm', 'rm.id', 'r.room_id')
        .innerJoin('buildings as b', 'b.id', 'rm.building_id')
        .innerJoin('contacts as c', 'c.id', 'r.contact_id')
        .select([
          'r.id',
          'rm.name as room_name',
          'c.name as guest_name',
          'b.property_id',
          'r.check_in_date',
          'r.check_out_date',
        ])
        .where('r.source', '=', 'WEBSITE')
        .where('r.status', '=', 'PENDING')
        .where('r.deleted_at', 'is', null)
        .where('r.created_at', '<', cutoff)
        .execute();
    },

    async cancel(id, actorId, ttlHours) {
      return db.transaction().execute(async (trx) => {
        const updated = await trx
          .updateTable('reservations')
          .set({ status: 'CANCELLED', updated_by: actorId, updated_at: sql`now()` })
          .where('id', '=', id)
          .where('status', '=', 'PENDING') // race guard: a concurrent confirm wins
          .where('deleted_at', 'is', null)
          .returning('id')
          .executeTakeFirst();

        if (!updated) return false;

        await trx
          .insertInto('audit_logs')
          .values({
            request_id: null,
            user_id: actorId,
            action: 'UPDATE',
            entity: 'reservations',
            entity_id: id,
            diff: { status: 'CANCELLED', reason: 'website_booking_expired', ttl_hours: ttlHours },
            ip_address: null,
          })
          .execute();

        return true;
      });
    },

    // Same attribution rule as PublicRepository.systemActorId: web bookings have no
    // logged-in user, so system actions on them stamp the oldest account.
    async systemActorId() {
      const row = await db
        .selectFrom('users')
        .select('id')
        .orderBy('created_at', 'asc')
        .limit(1)
        .executeTakeFirst();
      if (!row) throw new Error('No system user to attribute expired website bookings to');
      return row.id;
    },

    notify: (target, payload) => service.notify(target, payload),
  };
}

/** Bind the sweep to the real DB + notifications — the closure the scheduler runs. */
export function createWebsiteBookingExpiry(
  db: Kysely<Database> = defaultDb,
  service: NotificationsService = sharedNotifications,
): () => Promise<number> {
  const deps = buildDeps(db, service);
  return () => expireStaleWebsiteBookings(deps, env.WEBSITE_PENDING_TTL_HOURS);
}
