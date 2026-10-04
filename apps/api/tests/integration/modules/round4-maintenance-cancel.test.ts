/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, R3-8 residual) `POST /maintenance/:id/cancel {}` left the unit stuck in
 * MAINTENANCE: only an explicit `restore_room: true` put it back. Cancelling now puts the
 * unit back by default — unless another HIGH/CRITICAL job still needs it out of use, or a
 * guest is in it — and a caller can still say `restore_room: false` to keep it blocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createMaintenanceRouter } from '../../../src/modules/maintenance/maintenance.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ user: null as any }));
vi.mock('jsonwebtoken', () => ({
  default: { verify: () => { if (!mockState.user) throw new Error('jwt malformed'); return mockState.user; } },
}));

const app = express();
app.use(express.json());
app.use('/maintenance', createMaintenanceRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, propId: string, bldId: string, roomId: string;
const orders: string[] = [];
const roomStatus = async () => (await db.selectFrom('rooms').select('status').where('id', '=', roomId).executeTakeFirstOrThrow()).status;
const cancel = (id: string, body: object = {}) => request(app).post(`/maintenance/${id}/cancel`).set('Authorization', 'Bearer t').set('X-Property-Id', propId).send(body);

async function openOrder(priority: 'LOW' | 'HIGH' | 'CRITICAL') {
  const id = (await db.insertInto('maintenance_work_orders').values({
    room_id: roomId, title: `MC ${priority}`, priority, status: 'OPEN', reported_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  orders.push(id);
  await db.updateTable('rooms').set({ status: priority === 'LOW' ? 'AVAILABLE' : 'MAINTENANCE' }).where('id', '=', roomId).execute();
  return id;
}

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'MC', email: `mc-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `MC_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `MCB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'MC', code: `MC-${uniq}`, building_id: bldId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
  mockState.user = { sub: userId, role: 'admin', permissions: ['maintenance.update', 'maintenance.read', 'maintenance.delete', 'maintenance.cancel'] };
});

afterAll(async () => {
  await db.deleteFrom('maintenance_work_orders').where('id', 'in', orders).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('cancelling a work order', () => {
  it('puts the unit back in use when no body is sent', async () => {
    const id = await openOrder('HIGH');

    const res = await cancel(id);


    expect(res.status).toBe(200);
    expect(await roomStatus()).toBe('AVAILABLE');
  });

  it('keeps the unit out of use while another serious job is still open', async () => {
    const first = await openOrder('CRITICAL');
    await openOrder('HIGH');

    expect((await cancel(first)).status).toBe(200);

    expect(await roomStatus()).toBe('MAINTENANCE');
  });

  it('keeps the unit blocked when the caller asks for restore_room: false', async () => {
    await db.updateTable('maintenance_work_orders').set({ status: 'CANCELLED' } as never).where('room_id', '=', roomId).execute();
    const id = await openOrder('HIGH');

    expect((await cancel(id, { restore_room: false })).status).toBe(200);

    expect(await roomStatus()).toBe('MAINTENANCE');
  });

  it('never flips a unit a guest is in', async () => {
    await db.updateTable('maintenance_work_orders').set({ status: 'CANCELLED' } as never).where('room_id', '=', roomId).execute();
    const id = await openOrder('HIGH');
    await db.updateTable('rooms').set({ status: 'OCCUPIED' }).where('id', '=', roomId).execute();

    expect((await cancel(id)).status).toBe(200);

    expect(await roomStatus()).toBe('OCCUPIED');
  });
});
