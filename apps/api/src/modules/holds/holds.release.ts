import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/types.js';

interface Meta {
  userId: string;
  ip?: string;
  requestId?: string;
}

/**
 * (Re-test round 3, 2026-10-04) Let go of a booking's live (HELD) holds, in the caller's
 * transaction, and stop the unpaid payment attempts that hung off them.
 *
 * A hold is the cockpit wizard's "this unit, for this quote, while the guest pays". When
 * the booking moves on without that payment — confirmed with money still owed and paid
 * later at the desk, or cancelled — the hold used to stay HELD until its timer ran out.
 * Two things went wrong:
 *   - paying at the desk opens its own hold, and a second live hold on the unit tripped
 *     `holds_active_room_unique`: the "pay after the stay" case failed with a raw
 *     duplicate-key error (issue #110);
 *   - a cancelled booking kept a live hold on the unit and an "Awaiting" payment.
 * The wizard's payment intent is marked EXPIRED with the reason, so the Payments page
 * shows what happened instead of an attempt that is still "awaiting" forever.
 */
export async function releaseReservationHolds(
  trx: Kysely<Database>,
  reservationId: string,
  reason: 'superseded_by_desk_payment' | 'booking_cancelled' | 'booking_no_show',
  meta: Meta
): Promise<number> {
  const released = await trx
    .updateTable('holds')
    .set({ status: 'RELEASED', release_reason: reason, updated_by: meta.userId, updated_at: sql`now()` })
    .where('reservation_id', '=', reservationId)
    .where('status', '=', 'HELD')
    .where('deleted_at', 'is', null)
    .returning('id')
    .execute();
  if (released.length === 0) return 0;

  const holdIds = released.map((h) => h.id);
  const expired = await trx
    .updateTable('payment_intents')
    .set({ status: 'EXPIRED', last_error: reason.replace(/_/g, ' '), updated_by: meta.userId, updated_at: sql`now()` })
    .where('hold_id', 'in', holdIds)
    .where('status', 'in', ['PENDING', 'RETRY'])
    .returning('id')
    .execute();

  await trx.insertInto('audit_logs').values([
    ...holdIds.map((id) => ({
      request_id: meta.requestId ?? null,
      user_id: meta.userId,
      action: 'UPDATE' as const,
      entity: 'holds',
      entity_id: id,
      diff: { status: 'RELEASED', release_reason: reason },
      ip_address: meta.ip ?? null,
    })),
    ...expired.map((pi) => ({
      request_id: meta.requestId ?? null,
      user_id: meta.userId,
      action: 'UPDATE' as const,
      entity: 'payment_intents',
      entity_id: pi.id,
      diff: { status: 'EXPIRED', reason },
      ip_address: meta.ip ?? null,
    })),
  ]).execute();
  return released.length;
}
