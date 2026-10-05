/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R6 NEW-9) Two edits of one booking at once each trigger an immediate ledger reconcile.
 * Without a lock, the reconcile that read the OLD price could finish LAST and leave the
 * ledger disagreeing with the folio until the next sweep. Reconciles of one booking now
 * queue behind each other, and each re-reads the booking once it holds the queue.
 *
 * Deterministic: the first reconcile is paused (inside its work) right after it has read the
 * old price; while it waits, the price changes and a second reconcile is started. Unlocked,
 * the second finishes first and the stale first one overwrites it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { RevenueService } from '../../../src/modules/revenue/revenue.service.js';
import { RevenueRepository } from '../../../src/modules/revenue/revenue.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let userId: string, guestId: string, roomId: string, propertyId: string, bookingId: string;

const liveTotal = async () =>
  Number((await sql<{ s: string }>`SELECT COALESCE(SUM(amount),0) AS s FROM revenue_recognition WHERE reservation_id = ${bookingId}::uuid AND superseded_at IS NULL`.execute(db)).rows[0]!.s);

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'RR', email: `rr-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `RR guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  propertyId = (await db.insertInto('properties').values({ name: `RR_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  const b = (await db.insertInto('buildings').values({ property_id: propertyId, name: `RR_B_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'RR', code: `RR-${uniq}`.slice(0, 20), type: 'CONFERENCE', capacity: 2, building_id: b, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
  bookingId = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, source: 'DIRECT', created_by: userId, updated_by: userId,
    check_in_date: new Date('2035-05-01'), check_out_date: new Date('2035-05-03'), status: 'CONFIRMED',
    folio_total_amount: 200_000, folio_currency: 'BWP',
  } as never).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await sql`DELETE FROM revenue_recognition WHERE reservation_id = ${bookingId}::uuid`.execute(db);
  await db.deleteFrom('reservations').where('id', '=', bookingId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('property_id', '=', propertyId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('immediate revenue reconcile under concurrent edits', () => {
  it('ends agreeing with the latest price, whichever reconcile finishes first', async () => {
    const slowRepo = new RevenueRepository(db);
    const realLive = slowRepo.liveNights.bind(slowRepo);
    let second: Promise<unknown> | undefined;
    let paused = false;
    slowRepo.liveNights = async (id: string) => {
      if (!paused) {
        paused = true;
        // This reconcile has already read the P2,000 price. Now the booking is re-priced
        // (another edit commits) and that edit's own reconcile starts.
        await db.updateTable('reservations').set({ folio_total_amount: 300_000 } as never).where('id', '=', bookingId).execute();
        second = new RevenueService(new RevenueRepository(db)).reconcileFor([bookingId], { userId });
        await new Promise((r) => setTimeout(r, 300));
      }
      return realLive(id);
    };

    await new RevenueService(slowRepo).reconcileFor([bookingId], { userId });
    await second;
    expect(await liveTotal()).toBe(300_000);
  });
});
