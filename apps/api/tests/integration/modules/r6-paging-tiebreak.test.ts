/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R6) Paged lists ordered by created_at ALONE. Rows sharing a timestamp (300 seeded
 * bookings had 167 distinct ones) have no defined order, so Postgres may return them in a
 * different order for each page: page 2 repeated a row from page 1 and another row was
 * never shown at all. Every paged list now breaks ties on id. This walks bookings sharing
 * one timestamp, one per page, and expects each exactly once.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const N = 5;
const STAMP = new Date('2031-01-01T00:00:00Z'); // newer than anything else in the test DB
let userId: string, guestId: string, propId: string, bldId: string;
const roomIds: string[] = [], resIds: string[] = [];

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'PT', email: `pt-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `PT guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `PT_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `PTB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  for (let i = 0; i < N; i++) {
    const r = (await db.insertInto('rooms').values({ name: `PT${i}`, code: `PT${i}-${uniq}`.slice(0, 20), building_id: bldId, created_by: userId, updated_by: userId, created_at: STAMP } as never)
      .returning('id').executeTakeFirstOrThrow()).id;
    roomIds.push(r);
    resIds.push((await db.insertInto('reservations').values({
      contact_id: guestId, room_id: r, check_in_date: new Date('2031-02-01'), check_out_date: new Date('2031-02-03'),
      status: 'PENDING', source: 'DIRECT', created_by: userId, updated_by: userId, created_at: STAMP,
    } as never).returning('id').executeTakeFirstOrThrow()).id);
  }
});

afterAll(async () => {
  await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  await db.deleteFrom('rooms').where('id', 'in', roomIds).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

async function walk(fetchPage: (page: number) => Promise<string[]>, want: string[]) {
  const seen: string[] = [];
  for (let page = 1; page <= N; page++) seen.push(...(await fetchPage(page)));
  return seen.filter((id) => want.includes(id));
}

describe('paging with tied timestamps', () => {
  it('reservations: every booking exactly once, one per page', async () => {
    const repo = new ReservationsRepository(db);
    const seen = await walk(
      async (page) => (await repo.findPaginated({ property_id: propId } as never, { page, limit: 1 })).data.map((r) => r.id),
      resIds,
    );
    expect(seen.sort()).toEqual([...resIds].sort());
  });

  it('rooms: every unit exactly once, one per page', async () => {
    const repo = new RoomsRepository(db);
    const seen = await walk(
      async (page) => (await repo.findPaginated({ property_id: propId } as never, { page, limit: 1 })).data.map((r) => r.id),
      roomIds,
    );
    expect(seen.sort()).toEqual([...roomIds].sort());
  });
});
