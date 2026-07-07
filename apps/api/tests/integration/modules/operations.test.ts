/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the P4.3 Operational Cockpit: occupancy is bucketed to the right calendar
 * month, the trailing-12-completed-months window and its year-earlier comparison
 * select the correct bookings (no bleed between them), and everything is scoped to
 * the caller's accessible properties.
 *
 * Fixtures are self-created and each assertion runs SCOPED to those property ids,
 * and the expected window is derived from the same clock the service uses — so the
 * test is deterministic whatever "today" is (CI's lsp_test is seeded minimally).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ReportsRepository } from '../../../src/modules/reports/reports.repository.js';
import { ReportsService } from '../../../src/modules/reports/reports.service.js';

const service = new ReportsService(new ReportsRepository(db));

// Mirror the service's window math off the real clock.
const now = new Date();
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;
const round1 = (x: number) => Math.round(x * 10) / 10;

const from12 = monthStart(now.getUTCFullYear(), now.getUTCMonth() - 12);
const toExcl12 = monthStart(now.getUTCFullYear(), now.getUTCMonth());
const curDays = Math.round((toExcl12.getTime() - from12.getTime()) / DAY);
const prevFrom = monthStart(now.getUTCFullYear() - 1, now.getUTCMonth() - 12);
const prevToExcl = monthStart(now.getUTCFullYear() - 1, now.getUTCMonth());
const prevDays = Math.round((prevToExcl.getTime() - prevFrom.getTime()) / DAY);

// Most recent completed month (this year) and the same month one year earlier.
const lastMonthStart = monthStart(now.getUTCFullYear(), now.getUTCMonth() - 1);
const lastMonthKey = iso(lastMonthStart).slice(0, 7);
const daysInLastMonth = new Date(Date.UTC(lastMonthStart.getUTCFullYear(), lastMonthStart.getUTCMonth() + 1, 0)).getUTCDate();
const priorYearMonthStart = monthStart(now.getUTCFullYear() - 1, now.getUTCMonth() - 1);

const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const ROOMS = 2;

let userId: string;
let propId: string;
let buildingId: string;
let roomIds: string[] = [];
let guestId: string;
let resCur: string;
let resPrev: string;

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();

  const user = await db.insertInto('users')
    .values({ role_id: role.id, name: 'Ops Test', email: `ops-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow();
  userId = user.id;

  const prop = await db.insertInto('properties').values({ name: `OPS_TEST_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  propId = prop.id;

  const building = await db.insertInto('buildings').values({ property_id: propId, name: `OPS_BLDG_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  buildingId = building.id;

  const rooms = await db.insertInto('rooms')
    .values([
      { name: 'Ops 1', code: `OPS-1-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId },
      { name: 'Ops 2', code: `OPS-2-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId },
    ])
    .returning('id').execute();
  roomIds = rooms.map((r) => r.id);

  const guest = await db.insertInto('contacts')
    .values({ type: 'individual', name: 'Ops Guest', created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow();
  guestId = guest.id;

  // Current window: 10 nights in the most recent completed month.
  // Prior year: 4 nights in the same month one year earlier (lands in the
  // comparison window, NOT the current one). Inserted separately so each id is
  // captured directly (DATE columns round-trip to local midnight, so matching
  // fixtures back by date is unreliable).
  const cur = await db.insertInto('reservations')
    .values({ contact_id: guestId, room_id: roomIds[0]!, check_in_date: lastMonthStart, check_out_date: plusDays(lastMonthStart, 10), status: 'CHECKED_OUT', created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow();
  resCur = cur.id;
  const prev = await db.insertInto('reservations')
    .values({ contact_id: guestId, room_id: roomIds[0]!, check_in_date: priorYearMonthStart, check_out_date: plusDays(priorYearMonthStart, 4), status: 'CHECKED_OUT', created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow();
  resPrev = prev.id;
});

afterAll(async () => {
  await db.deleteFrom('reservations').where('id', 'in', [resCur, resPrev]).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', 'in', roomIds).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Operational Cockpit — occupancy trends (live DB)', () => {
  it('returns a trailing 12 completed-month window', async () => {
    const r = await service.getOperations({ accessiblePropertyIds: [propId] });
    expect(r.window.months).toBe(12);
    expect(r.window.from).toBe(iso(from12));
    expect(r.window.to).toBe(iso(plusDays(toExcl12, -1)));
    expect(r.monthly).toHaveLength(12);
  });

  it('buckets booked nights into the month they occur, with rooms×days available', async () => {
    const r = await service.getOperations({ accessiblePropertyIds: [propId] });
    const m = r.monthly.find((p) => p.month === lastMonthKey)!;
    expect(m.room_nights_booked).toBe(10);
    expect(m.room_nights_available).toBe(ROOMS * daysInLastMonth);
    expect(m.occupancy_pct).toBe(round1((10 / (ROOMS * daysInLastMonth)) * 100));
    // A different month with no booking reads zero.
    const empty = r.monthly.find((p) => p.month !== lastMonthKey)!;
    expect(empty.room_nights_booked).toBe(0);
    expect(empty.occupancy_pct).toBe(0);
  });

  it('summarises the window and compares against the same months last year', async () => {
    const r = await service.getOperations({ accessiblePropertyIds: [propId] });
    // Current window sees only the 10-night stay; prior-year window only the 4-night one.
    expect(r.summary.room_nights_booked).toBe(10);
    expect(r.summary.reservations).toBe(1);
    expect(r.summary.room_nights_available).toBe(ROOMS * curDays);
    expect(r.summary.occupancy_pct).toBe(round1((10 / (ROOMS * curDays)) * 100));

    expect(r.previous.room_nights_booked).toBe(4);
    expect(r.previous.reservations).toBe(1);
    expect(r.previous.occupancy_pct).toBe(round1((4 / (ROOMS * prevDays)) * 100));

    expect(r.deltas.occupancy_pts).toBe(round1(r.summary.occupancy_pct - r.previous.occupancy_pct));
    expect(r.deltas.reservations_pct).toBe(0); // 1 vs 1
  });

  it('breaks occupancy down per property', async () => {
    const r = await service.getOperations({ accessiblePropertyIds: [propId] });
    const p = r.by_property.find((row) => row.property_id === propId)!;
    expect(p.room_nights_booked).toBe(10);
    expect(p.reservations).toBe(1);
    expect(p.occupancy_pct).toBe(round1((10 / (ROOMS * curDays)) * 100));
  });

  it('scopes to the caller’s accessible properties', async () => {
    const none = await service.getOperations({ accessiblePropertyIds: [] });
    expect(none.summary.room_nights_booked).toBe(0);
    expect(none.summary.reservations).toBe(0);
    expect(none.monthly.every((m) => m.occupancy_pct === 0)).toBe(true);
    expect(none.by_property).toHaveLength(0);
  });
});
