/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4) Cancelled bookings that kept paid money sat in the books unnoticed. Finance now
 * lists them — and only them — for the active property. Nothing is refunded automatically.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createFinanceRouter } from '../../../src/modules/finance/finance.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ user: null as any }));
vi.mock('jsonwebtoken', () => ({
  default: { verify: () => { if (!mockState.user) throw new Error('jwt malformed'); return mockState.user; } },
}));
const app = express();
app.use(express.json());
app.use('/finance', createFinanceRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, guestId: string, propA: string, propB: string, roomA: string, roomB: string;
const created: { buildings: string[]; reservations: string[]; invoices: string[] } = { buildings: [], reservations: [], invoices: [] };
let seq = 0;

async function unit(label: string) {
  const property = (await db.insertInto('properties').values({ name: `HC_${label}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  const building = (await db.insertInto('buildings').values({ property_id: property, name: `HCB_${label}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  created.buildings.push(building);
  const room = (await db.insertInto('rooms').values({ name: `HC ${label}`, code: `HC-${label}-${uniq}`.slice(0, 20), building_id: building, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
  return { property, room };
}
async function stay(roomId: string, status: string, day: number, paid: number, refunded = 0) {
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, status, source: 'DIRECT', created_by: userId, updated_by: userId,
    check_in_date: new Date(Date.UTC(2038, 0, day)), check_out_date: new Date(Date.UTC(2038, 0, day + 1)),
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  created.reservations.push(id);
  const inv = async (kind: string, total: number, st: string) => {
    created.invoices.push((await db.insertInto('invoices').values({
      number: `HC-${uniq}-${seq++}`, reservation_id: id, kind, status: st, subtotal_amount: total, tax_rate_bps: 0, tax_amount: 0,
      total_amount: total, issued_by: userId, created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow()).id);
  };
  if (paid) await inv('DEPOSIT', paid, 'PAID');
  if (refunded) await inv('REFUND', refunded, 'PAID');
  return id;
}
const get = (property: string) => request(app).get('/finance/cancelled-with-money').set('Authorization', 'Bearer t').set('X-Property-Id', property);

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'HC', email: `hc-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `HC guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  ({ property: propA, room: roomA } = await unit('A'));
  ({ property: propB, room: roomB } = await unit('B'));
  mockState.user = { sub: userId, role: 'admin', permissions: ['invoices.read'] };
});
afterAll(async () => {
  await db.deleteFrom('invoices').where('id', 'in', created.invoices).execute();
  await db.deleteFrom('reservations').where('id', 'in', created.reservations).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomA, roomB]).execute();
  await db.deleteFrom('buildings').where('id', 'in', created.buildings).execute();
  await db.deleteFrom('properties').where('id', 'in', [propA, propB]).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('GET /finance/cancelled-with-money', () => {
  it('lists cancelled and no-show bookings that still hold money, biggest first', async () => {
    const cancelled = await stay(roomA, 'CANCELLED', 1, 300_000);
    const noShow = await stay(roomA, 'NO_SHOW', 3, 120_000);

    const res = await get(propA);

    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: any) => [r.reservation_id, r.status, r.received])).toEqual([
      [cancelled, 'CANCELLED', 300_000],
      [noShow, 'NO_SHOW', 120_000],
    ]);
    expect(res.body.total_held).toBe(420_000);
    expect(res.body.count).toBe(2);
    expect(res.body.rows[0].room_code).toContain('HC-A');
  });

  it('leaves out bookings that are live, unpaid, or already fully refunded', async () => {
    await stay(roomA, 'CONFIRMED', 5, 200_000);
    await stay(roomA, 'CANCELLED', 7, 0);
    const refunded = await stay(roomA, 'CANCELLED', 9, 150_000, 150_000);
    const part = await stay(roomA, 'CANCELLED', 11, 150_000, 50_000);

    const res = await get(propA);

    const ids = res.body.rows.map((r: any) => r.reservation_id);
    expect(ids).not.toContain(refunded);
    expect(res.body.rows.find((r: any) => r.reservation_id === part).received).toBe(100_000);
    expect(res.body.rows.every((r: any) => ['CANCELLED', 'NO_SHOW'].includes(r.status))).toBe(true);
  });

  it('shows only the active property’s bookings', async () => {
    const other = await stay(roomB, 'CANCELLED', 13, 80_000);

    const a = await get(propA);
    const b = await get(propB);

    expect(a.body.rows.map((r: any) => r.reservation_id)).not.toContain(other);
    expect(b.body.rows.map((r: any) => r.reservation_id)).toEqual([other]);
  });

  it('needs the reports permission', async () => {
    mockState.user = { sub: userId, role: 'reception', permissions: ['reservations.read'] };

    expect((await get(propA)).status).toBe(403);

    mockState.user = { sub: userId, role: 'admin', permissions: ['invoices.read'] };
  });
});
