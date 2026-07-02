/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the Phase 3 three-stage housekeeping flow end-to-end through the real
 * router + live DB: a cleaner starts the turn, a supervisor validates it, and
 * ONLY a manager with housekeeping.signoff can sign the unit back to READY —
 * with each stage stamping who did it. Fixtures are self-created (CI's
 * lsp_test is seeded minimally).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createHousekeepingRouter } from '../../../src/modules/housekeeping/housekeeping.routes.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ user: null as any }));

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: () => {
      if (!mockState.user) throw new Error('jwt malformed');
      return mockState.user;
    },
  },
}));

const app = express();
app.use(express.json());
app.use('/api/housekeeping', createHousekeepingRouter());
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.statusCode ?? 500).json({ message: err.message });
});

let cleanerId: string;
let supervisorId: string;
let managerId: string;
let propertyId: string;
let buildingId: string;
let roomId: string;
let taskId: string;

function as(userId: string, permissions: string[]) {
  mockState.user = { sub: userId, role: 'housekeeping', permissions };
}
const asCleaner = () => as(cleanerId, ['housekeeping.read', 'housekeeping.update']);
const asSupervisor = () => as(supervisorId, ['housekeeping.read', 'housekeeping.update', 'housekeeping.inspect']);
const asManager = () => as(managerId, ['housekeeping.read', 'housekeeping.signoff']);

function post(path: string, body: Record<string, unknown> = {}) {
  return request(app).post(path).set('Authorization', 'Bearer t').set('X-Property-Id', propertyId).send(body);
}

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const role = await db.selectFrom('roles').select('id').where('name', '=', 'housekeeping').executeTakeFirstOrThrow();

  const users = await db
    .insertInto('users')
    .values([
      { role_id: role.id, name: 'HK Cleaner', email: `hk-cleaner-${uniq}@test.local`, password_hash: 'x' },
      { role_id: role.id, name: 'HK Supervisor', email: `hk-super-${uniq}@test.local`, password_hash: 'x' },
      { role_id: role.id, name: 'HK Manager', email: `hk-manager-${uniq}@test.local`, password_hash: 'x' },
    ])
    .returning(['id', 'name'])
    .execute();
  cleanerId = users.find((u) => u.name === 'HK Cleaner')!.id;
  supervisorId = users.find((u) => u.name === 'HK Supervisor')!.id;
  managerId = users.find((u) => u.name === 'HK Manager')!.id;

  const prop = await db
    .insertInto('properties')
    .values({ name: `HK_SIGNOFF_TEST_PROP_${uniq}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  propertyId = prop.id;

  await db
    .insertInto('user_properties')
    .values([cleanerId, supervisorId, managerId].map((user_id) => ({ user_id, property_id: propertyId })))
    .execute();

  const building = await db
    .insertInto('buildings')
    .values({ property_id: propertyId, name: `HK_SIGNOFF_TEST_BLDG_${uniq}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  buildingId = building.id;

  const room = await db
    .insertInto('rooms')
    .values({
      name: 'Signoff Test Room', code: `HKS-${uniq}`, building_id: buildingId,
      housekeeping_status: 'DIRTY', created_by: managerId, updated_by: managerId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  roomId = room.id;

  const task = await db
    .insertInto('housekeeping_tasks')
    .values({ room_id: roomId, status: 'OPEN', created_by: managerId, updated_by: managerId })
    .returning('id')
    .executeTakeFirstOrThrow();
  taskId = task.id;
});

afterAll(async () => {
  await db.deleteFrom('housekeeping_tasks').where('id', '=', taskId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', [cleanerId, supervisorId, managerId]).execute();
  await db.deleteFrom('users').where('id', 'in', [cleanerId, supervisorId, managerId]).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
});

describe('Three-stage housekeeping flow (live DB)', () => {
  it('stage 1 — the cleaner starts the turn (started_by stamped)', async () => {
    asCleaner();
    const res = await post(`/api/housekeeping/rooms/${roomId}/start`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CLEANING');
    expect(res.body.started_by).toBe(cleanerId);
  });

  it('a cleaner cannot validate their own clean (403)', async () => {
    asCleaner();
    expect((await post(`/api/housekeeping/rooms/${roomId}/inspect`)).status).toBe(403);
  });

  it('stage 2 — the supervisor validates (inspected_by stamped)', async () => {
    asSupervisor();
    const res = await post(`/api/housekeeping/rooms/${roomId}/inspect`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INSPECTED');
    expect(res.body.inspected_by).toBe(supervisorId);
  });

  it('neither the cleaner nor the supervisor can sign off (403)', async () => {
    asCleaner();
    expect((await post(`/api/housekeeping/rooms/${roomId}/ready`)).status).toBe(403);
    asSupervisor();
    expect((await post(`/api/housekeeping/rooms/${roomId}/ready`)).status).toBe(403);
  });

  it('stage 3 — the manager signs off; unit goes READY (signed_off_by stamped)', async () => {
    asManager();
    const res = await post(`/api/housekeeping/rooms/${roomId}/ready`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DONE');
    expect(res.body.signed_off_by).toBe(managerId);

    const room = await db
      .selectFrom('rooms')
      .select('housekeeping_status')
      .where('id', '=', roomId)
      .executeTakeFirstOrThrow();
    expect(room.housekeeping_status).toBe('READY');

    // Full per-stage accountability on the finished task.
    const task = await db
      .selectFrom('housekeeping_tasks')
      .select(['started_by', 'inspected_by', 'signed_off_by'])
      .where('id', '=', taskId)
      .executeTakeFirstOrThrow();
    expect(task).toEqual({ started_by: cleanerId, inspected_by: supervisorId, signed_off_by: managerId });
  });

  it('sign-off cannot skip validation — a fresh CLEANING unit 409s', async () => {
    // Reset the task to CLEANING to prove the stage order is enforced.
    await db.updateTable('housekeeping_tasks').set({ status: 'CLEANING' }).where('id', '=', taskId).execute();
    asManager();
    const res = await post(`/api/housekeeping/rooms/${roomId}/ready`);
    expect(res.status).toBe(409);
    await db.updateTable('housekeeping_tasks').set({ status: 'DONE' }).where('id', '=', taskId).execute();
  });
});
