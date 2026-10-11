/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit 2026-10-11, M-1) The Booking.com feed publishes every booking except those that came
 * from Booking.com, so the source label decides what the channel sees. An edit may not move a
 * booking across that line — relabelled as BOOKING_COM it would vanish from the feed (double
 * selling); a Booking.com booking relabelled as ours would be echoed back. The drawer re-sends
 * the source on every save, so saving it unchanged must keep working.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createReservationsRouter } from '../../../src/modules/reservations/reservations.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ user: null as any }));
vi.mock('jsonwebtoken', () => ({
  default: { verify: () => { if (!mockState.user) throw new Error('jwt malformed'); return mockState.user; } },
}));

const app = express();
app.use(express.json());
app.use('/reservations', createReservationsRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, propId: string, bldId: string, roomId: string, guestId: string;
let walkIn: string, ota: string;

const patch = (id: string, body: object) =>
  request(app).patch(`/reservations/${id}`).set('Authorization', 'Bearer t').set('x-property-id', propId).send(body);

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'M1', email: `m1-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `M1_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `M1B_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'M1', code: `M1-${uniq}`.slice(0, 20), building_id: bldId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `M1 guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  const book = async (source: string, from: string, to: string, status = 'PENDING') =>
    (await db.insertInto('reservations').values({
      contact_id: guestId, room_id: roomId, check_in_date: new Date(from), check_out_date: new Date(to),
      status, source, created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  walkIn = await book('WALK_IN', '2038-01-10', '2038-01-12');
  ota = await book('BOOKING_COM', '2038-02-10', '2038-02-12', 'CONFIRMED');
  mockState.user = { sub: userId, role: 'admin', permissions: ['reservations.read', 'reservations.update'] };
});

afterAll(async () => {
  await db.deleteFrom('reservations').where('room_id', '=', roomId).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Audit M-1 — the Booking.com label can’t be switched by an edit', () => {
  it('refuses relabelling a desk booking as Booking.com (it would vanish from the feed)', async () => {
    const res = await patch(walkIn, { source: 'BOOKING_COM' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Booking\.com/);
  });

  it('refuses relabelling a Booking.com booking as our own (it would echo back)', async () => {
    expect((await patch(ota, { source: 'DIRECT' })).status).toBe(400);
  });

  it('still lets staff change between our own labels, and re-save a Booking.com booking as it is', async () => {
    expect((await patch(walkIn, { source: 'PHONE' })).status).toBe(200);
    expect((await patch(ota, { source: 'BOOKING_COM', notes: 'checked in late' })).status).toBe(200);
  });
});
