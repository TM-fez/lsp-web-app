/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R7 N7-1, CRITICAL) The R6 per-booking lock held one pooled connection (a session
 * advisory lock) while the work inside it asked the SAME pool for more. With as many
 * reconciles in flight as the pool has connections, every connection sat idle holding a
 * lock and waiting for a connection that would never come back — the API froze until a
 * restart (/health still said ok). Every booking write triggers one of these.
 *
 * Here: a pool of 4, and 12 reconciles at once (same booking and different ones). They
 * must all finish, the ledger must be right, and the pool must still answer afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pkg from 'pg';
import { db } from '../../../src/config/db.js';
import type { Database } from '../../../src/db/types.js';
import { RevenueService } from '../../../src/modules/revenue/revenue.service.js';
import { RevenueRepository } from '../../../src/modules/revenue/revenue.repository.js';

const APP = `r7-freeze-${process.pid}`;
const POOL_SIZE = 4;
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let small: Kysely<Database>;
let userId: string, guestId: string, roomId: string, propertyId: string;
const bookingIds: string[] = [];

const within = <T>(ms: number, p: Promise<T>) =>
  Promise.race([p, new Promise<'HUNG'>((r) => setTimeout(() => r('HUNG'), ms))]);

beforeAll(async () => {
  const pool = new pkg.Pool({ connectionString: process.env.DATABASE_URL, max: POOL_SIZE, application_name: APP });
  // A connection ended from the server side (the clean-up below, after a hang) must not
  // become an uncaught error that takes the whole test worker down with it.
  pool.on('error', () => undefined);
  small = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'R7F', email: `r7f-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `R7F guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  propertyId = (await db.insertInto('properties').values({ name: `R7F_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  const b = (await db.insertInto('buildings').values({ property_id: propertyId, name: `R7F_B_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'R7F', code: `R7F-${uniq}`.slice(0, 20), type: 'CONFERENCE', capacity: 2, building_id: b, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
  for (let i = 0; i < 6; i += 1) {
    const day = (n: number) => new Date(Date.UTC(2036, 0, 1 + i * 3 + n));
    bookingIds.push((await db.insertInto('reservations').values({
      contact_id: guestId, room_id: roomId, source: 'DIRECT', created_by: userId, updated_by: userId,
      check_in_date: day(0), check_out_date: day(2), status: 'CONFIRMED',
      folio_total_amount: 100_000 * (i + 1), folio_currency: 'BWP',
    } as never).returning('id').executeTakeFirstOrThrow()).id);
  }
});

afterAll(async () => {
  // Close the small pool normally; only if that hangs (the old code deadlocked, its
  // connections are parked) end them from the server side so it can close.
  if ((await within(3_000, small.destroy().catch(() => undefined))) === 'HUNG') {
    await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = ${APP}`.execute(db);
  }
  await sql`DELETE FROM revenue_recognition WHERE reservation_id = ANY(${bookingIds}::uuid[])`.execute(db);
  await db.deleteFrom('reservations').where('id', 'in', bookingIds).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('property_id', '=', propertyId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});


describe('immediate revenue reconcile under load', () => {
  it('finishes with three times more reconciles in flight than the pool has connections', async () => {
    const service = new RevenueService(new RevenueRepository(small));
    // Twelve at once: two per booking, so both "same booking queues" and "different
    // bookings in parallel" are exercised against a pool of four.
    const runs = [...bookingIds, ...bookingIds].map((id) => service.reconcileFor([id], { userId }));
    const outcome = await within(10_000, Promise.all(runs));
    expect(outcome).not.toBe('HUNG');

    // The pool still answers…
    expect(await within(2_000, sql`SELECT 1 AS ok`.execute(small))).not.toBe('HUNG');
    // …and every booking's ledger matches its folio.
    const totals = await sql<{ id: string; s: string }>`
      SELECT reservation_id AS id, SUM(amount) AS s FROM revenue_recognition
      WHERE reservation_id = ANY(${bookingIds}::uuid[]) AND superseded_at IS NULL GROUP BY 1`.execute(db);
    const byId = new Map(totals.rows.map((r) => [r.id, Number(r.s)]));
    bookingIds.forEach((id, i) => expect(byId.get(id)).toBe(100_000 * (i + 1)));
  }, 20_000);
});
