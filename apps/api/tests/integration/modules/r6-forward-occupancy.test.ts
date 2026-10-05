/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R6) forwardOccupancy summed LEAST(check_out, …) − GREATEST(check_in, …) over a LEFT JOIN.
 * Postgres' LEAST/GREATEST IGNORE NULLs, so a unit with NO booking counted as fully booked:
 * CBD, with 0 bookings, read "150% of the next 7 days is already booked". A unit with no
 * booking must count 0 nights, and a property can never be more than 100% booked.
 * (D02) A held — PENDING — night is forward demand too; it was missing from this query.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ReportsRepository } from '../../../src/modules/reports/reports.repository.js';
import { buildNudges } from '../../../src/modules/reports/reports.nudges.js';
import { todayInPropertyTZ } from '../../../src/core/time.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, guestId: string;
const props: string[] = [], blds: string[] = [], rooms: string[] = [], bookings: string[] = [];

const day = (offset: number) => {
  const d = new Date(`${todayInPropertyTZ()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

async function property(label: string, units: number) {
  const p = (await db.insertInto('properties').values({ name: `FO_${label}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  const b = (await db.insertInto('buildings').values({ property_id: p, name: `FOB_${label}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  props.push(p); blds.push(b);
  const ids: string[] = [];
  for (let i = 0; i < units; i++) {
    const r = (await db.insertInto('rooms').values({ name: `FO ${label}${i}`, code: `FO-${label}${i}-${uniq}`.slice(0, 20), building_id: b, created_by: userId, updated_by: userId })
      .returning('id').executeTakeFirstOrThrow()).id;
    rooms.push(r); ids.push(r);
  }
  return { p, rooms: ids };
}

async function book(roomId: string, from: number, to: number, status: 'PENDING' | 'CONFIRMED') {
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, check_in_date: day(from), check_out_date: day(to), status, source: 'DIRECT',
    created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  bookings.push(id);
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'FO', email: `fo-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `FO guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  if (bookings.length) await db.deleteFrom('reservations').where('id', 'in', bookings).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  if (rooms.length) await db.deleteFrom('rooms').where('id', 'in', rooms).execute();
  if (blds.length) await db.deleteFrom('buildings').where('id', 'in', blds).execute();
  if (props.length) await db.deleteFrom('properties').where('id', 'in', props).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('forward occupancy', () => {
  it('a property with units but no bookings is 0% booked — not "fully booked"', async () => {
    const empty = await property('E', 3);
    const row = (await new ReportsRepository(db).forwardOccupancy()).find((r) => r.property_id === empty.p)!;
    expect(row).toMatchObject({ booked_nights_7: 0, booked_nights_30: 0, room_count: 3 });
    expect(buildNudges([row]).some((n) => n.property_id === empty.p && /already booked/.test(n.detail))).toBe(false);
  });

  it('counts only real nights (held PENDING ones too, D02) and never exceeds 100%', async () => {
    const busy = await property('B', 2);
    await book(busy.rooms[0]!, 0, 7, 'CONFIRMED'); // 7 nights in the 7-day window
    await book(busy.rooms[1]!, 2, 5, 'PENDING');   // 3 held nights
    const row = (await new ReportsRepository(db).forwardOccupancy()).find((r) => r.property_id === busy.p)!;
    expect(row.booked_nights_7).toBe(10);
    expect(row.booked_nights_7).toBeLessThanOrEqual(row.room_count * 7);
    expect(row.booked_nights_30).toBeLessThanOrEqual(row.room_count * 30);
  });
});
