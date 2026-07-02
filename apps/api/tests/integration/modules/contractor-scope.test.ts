/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the Phase 3 contractor scoping end-to-end through the real router +
 * live DB: a contractor sees ONLY the work orders assigned to them (list is
 * pinned server-side, foreign by-id reads are 404), can start/complete their
 * own ticket via the narrow maintenance.work permission, and cannot reach the
 * staff-only mutations (edit/assign/cost/cancel). Also proves contractors are
 * excluded from property-wide notification fan-outs. Fixtures are self-created
 * (CI's lsp_test is seeded minimally).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createMaintenanceRouter } from '../../../src/modules/maintenance/maintenance.routes.js';
import { NotificationsRepository } from '../../../src/modules/notifications/notifications.repository.js';
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
app.use('/api/maintenance', createMaintenanceRouter());
// Surface AppError statuses instead of Express's default 500.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.statusCode ?? 500).json({ message: err.message });
});

let contractorId: string;
let staffId: string;
let propertyId: string;
let buildingId: string;
let roomId: string;
let woMine: string;   // assigned to the contractor
let woTheirs: string; // assigned to staff

const CONTRACTOR_PERMS = ['maintenance.read', 'maintenance.work', 'maintenance.complete'];
const STAFF_PERMS = ['maintenance.read', 'maintenance.create', 'maintenance.update', 'maintenance.complete'];

function asContractor() {
  mockState.user = { sub: contractorId, role: 'contractor', permissions: CONTRACTOR_PERMS };
}
function asStaff() {
  mockState.user = { sub: staffId, role: 'maintenance', permissions: STAFF_PERMS };
}
function get(path: string) {
  return request(app).get(path).set('Authorization', 'Bearer t').set('X-Property-Id', propertyId);
}
function post(path: string, body: Record<string, unknown> = {}) {
  return request(app).post(path).set('Authorization', 'Bearer t').set('X-Property-Id', propertyId).send(body);
}
function patch(path: string, body: Record<string, unknown> = {}) {
  return request(app).patch(path).set('Authorization', 'Bearer t').set('X-Property-Id', propertyId).send(body);
}

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const contractorRole = await db
    .selectFrom('roles').select('id').where('name', '=', 'contractor').executeTakeFirstOrThrow();
  const staffRole = await db
    .selectFrom('roles').select('id').where('name', '=', 'maintenance').executeTakeFirstOrThrow();

  const users = await db
    .insertInto('users')
    .values([
      { role_id: contractorRole.id, name: 'Contractor Test', email: `contractor-${uniq}@test.local`, password_hash: 'x' },
      { role_id: staffRole.id, name: 'Staff Test', email: `staff-${uniq}@test.local`, password_hash: 'x' },
    ])
    .returning(['id', 'name'])
    .execute();
  contractorId = users.find((u) => u.name === 'Contractor Test')!.id;
  staffId = users.find((u) => u.name === 'Staff Test')!.id;

  const prop = await db
    .insertInto('properties')
    .values({ name: `CONTRACTOR_TEST_PROP_${uniq}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  propertyId = prop.id;

  await db
    .insertInto('user_properties')
    .values([
      { user_id: contractorId, property_id: propertyId },
      { user_id: staffId, property_id: propertyId },
    ])
    .execute();

  const building = await db
    .insertInto('buildings')
    .values({ property_id: propertyId, name: `CONTRACTOR_TEST_BLDG_${uniq}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  buildingId = building.id;

  const room = await db
    .insertInto('rooms')
    .values({ name: 'Contractor Test Room', code: `CTR-${uniq}`, building_id: buildingId, created_by: staffId, updated_by: staffId })
    .returning('id')
    .executeTakeFirstOrThrow();
  roomId = room.id;

  const orders = await db
    .insertInto('maintenance_work_orders')
    .values([
      { room_id: roomId, title: 'Contractor ticket', reported_by: staffId, assigned_to: contractorId },
      { room_id: roomId, title: 'Staff ticket', reported_by: staffId, assigned_to: staffId },
    ])
    .returning(['id', 'title'])
    .execute();
  woMine = orders.find((o) => o.title === 'Contractor ticket')!.id;
  woTheirs = orders.find((o) => o.title === 'Staff ticket')!.id;
});

afterAll(async () => {
  await db.deleteFrom('notifications').where('entity_id', 'in', [woMine, woTheirs]).execute();
  await db.deleteFrom('maintenance_work_orders').where('id', 'in', [woMine, woTheirs]).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', [contractorId, staffId]).execute();
  await db.deleteFrom('notifications').where('user_id', 'in', [contractorId, staffId]).execute();
  await db.deleteFrom('users').where('id', 'in', [contractorId, staffId]).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
});

describe('Contractor scoping (live DB)', () => {
  it('list is pinned to the contractor’s own tickets — even when the query asks for more', async () => {
    asContractor();
    const res = await get('/api/maintenance');
    expect(res.status).toBe(200);
    expect(res.body.data.map((o: any) => o.id)).toEqual([woMine]);

    // Trying to filter for someone else's tickets still yields only your own.
    const forged = await get(`/api/maintenance?assigned_to=${staffId}`);
    expect(forged.body.data.map((o: any) => o.id)).toEqual([woMine]);
  });

  it('staff with the same property see every ticket', async () => {
    asStaff();
    const res = await get('/api/maintenance');
    expect(res.status).toBe(200);
    expect(res.body.data.map((o: any) => o.id).sort()).toEqual([woMine, woTheirs].sort());
  });

  it('a foreign ticket is "not found" by id, mine is visible', async () => {
    asContractor();
    expect((await get(`/api/maintenance/${woTheirs}`)).status).toBe(404);
    expect((await get(`/api/maintenance/${woMine}`)).status).toBe(200);
  });

  it('maintenance.work lets a contractor start THEIR ticket only', async () => {
    asContractor();
    expect((await post(`/api/maintenance/${woTheirs}/start`)).status).toBe(404);

    const res = await post(`/api/maintenance/${woMine}/start`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it('staff still start via maintenance.update (the other arm of authorizeAny)', async () => {
    asStaff();
    const res = await post(`/api/maintenance/${woTheirs}/start`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it('staff-only mutations are forbidden for contractors (403, not 404 — permission runs first)', async () => {
    asContractor();
    expect((await patch(`/api/maintenance/${woMine}`, { title: 'Renamed' })).status).toBe(403);
    expect((await patch(`/api/maintenance/${woMine}/assign`, { assigned_to: null })).status).toBe(403);
    expect((await patch(`/api/maintenance/${woMine}/cost`, { cost_amount: 100 })).status).toBe(403);
    expect((await post(`/api/maintenance/${woMine}/cancel`)).status).toBe(403);
    expect((await post(`/api/maintenance/${woMine}/approve`)).status).toBe(403);
  });

  it('a contractor can complete their own ticket', async () => {
    asContractor();
    const res = await post(`/api/maintenance/${woMine}/complete`, {});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.completed_by).toBe(contractorId);
  });

  it('property-wide notification fan-outs exclude contractors', async () => {
    const repo = new NotificationsRepository(db);
    const ids = await repo.userIdsForProperty(propertyId);
    expect(ids).toContain(staffId);
    expect(ids).not.toContain(contractorId);
  });
});
