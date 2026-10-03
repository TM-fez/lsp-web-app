/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (H6) Scope and security leaks from the October test round, each proved through the
 * real router + live DB:
 *   · a contractor could read ANY file by id (files.read alone);
 *   · /expenses listed — and let you sign off — every property's repair costs;
 *   · editing a work order's cost through the general PATCH kept its old approval;
 *   · every rooms read carried the iCal feed token and the guest QR token;
 *   · malformed input (a bad uuid, broken JSON) came back as a 500 with raw DB text.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createFilesRouter } from '../../../src/modules/files/files.routes.js';
import { createExpensesRouter } from '../../../src/modules/expenses/expenses.routes.js';
import { createMaintenanceRouter } from '../../../src/modules/maintenance/maintenance.routes.js';
import { createRoomsRouter } from '../../../src/modules/rooms/rooms.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
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
app.use('/files', createFilesRouter());
app.use('/expenses', createExpensesRouter());
app.use('/maintenance', createMaintenanceRouter());
app.use('/rooms', createRoomsRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let contractorId: string, staffId: string, accountsId: string;
let propA: string, propB: string, bldA: string, bldB: string, roomA: string, roomB: string;
let fileMine: string, fileOnMyOrder: string, fileOther: string;
let woA: string, woB: string;

const as = (sub: string, role: string, permissions: string[]) => {
  mockState.user = { sub, role, permissions };
};
const asContractor = () => as(contractorId, 'contractor', ['files.read', 'maintenance.read']);
const asAccountsA = () => as(accountsId, 'accounts', ['expenses.read', 'expenses.approve', 'rooms.read']);
const asStaff = () => as(staffId, 'operations', ['files.read', 'maintenance.read', 'maintenance.update', 'rooms.read', 'rooms.update']);

const get = (path: string, property = propA) =>
  request(app).get(path).set('Authorization', 'Bearer t').set('X-Property-Id', property);
const send = (method: 'post' | 'patch', path: string, body: unknown, property = propA) =>
  request(app)[method](path).set('Authorization', 'Bearer t').set('X-Property-Id', property).send(body as object);

async function makeFile(createdBy: string, tag: string) {
  return (await db.insertInto('files').values({
    original_name: `${tag}.jpg`, stored_name: `${tag}-${uniq}.jpg`, mime_type: 'image/jpeg', extension: 'jpg',
    size_bytes: 1, checksum: 'x', storage_driver: 'local', bucket: null, path: `/nowhere/${tag}-${uniq}`,
    created_by: createdBy,
  }).returning('id').executeTakeFirstOrThrow()).id;
}

beforeAll(async () => {
  const roleId = async (name: string) =>
    (await db.selectFrom('roles').select('id').where('name', '=', name).executeTakeFirstOrThrow()).id;
  const mkUser = async (role: string, tag: string) =>
    (await db.insertInto('users').values({
      role_id: await roleId(role), name: `H6 ${tag}`, email: `h6-${tag}-${uniq}@test.local`, password_hash: 'x',
    }).returning('id').executeTakeFirstOrThrow()).id;
  contractorId = await mkUser('contractor', 'contractor');
  staffId = await mkUser('operations', 'staff');
  accountsId = await mkUser('operations', 'accounts');

  const mkProp = async (tag: string) => {
    const p = (await db.insertInto('properties').values({ name: `H6_${tag}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const b = (await db.insertInto('buildings').values({ property_id: p, name: `H6_B${tag}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const r = (await db.insertInto('rooms').values({
      name: `H6 ${tag}`, code: `H6-${tag}-${uniq}`, building_id: b, created_by: staffId, updated_by: staffId,
    }).returning('id').executeTakeFirstOrThrow()).id;
    return { p, b, r };
  };
  ({ p: propA, b: bldA, r: roomA } = await mkProp('A'));
  ({ p: propB, b: bldB, r: roomB } = await mkProp('B'));

  // Accounts and the contractor only belong to A; staff to both.
  await db.insertInto('user_properties').values([
    { user_id: accountsId, property_id: propA },
    { user_id: contractorId, property_id: propA },
    { user_id: staffId, property_id: propA },
    { user_id: staffId, property_id: propB },
  ]).execute();

  fileMine = await makeFile(contractorId, 'mine');
  fileOnMyOrder = await makeFile(staffId, 'on-my-order');
  fileOther = await makeFile(staffId, 'other');

  const mkWo = async (room: string, tag: string, extra: Record<string, unknown> = {}) =>
    (await db.insertInto('maintenance_work_orders').values({
      room_id: room, title: `H6 ${tag}`, priority: 'MEDIUM', status: 'OPEN', cost_amount: 50_000,
      reported_by: staffId, ...extra,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  woA = await mkWo(roomA, 'A', { assigned_to: contractorId, before_file_id: fileOnMyOrder });
  woB = await mkWo(roomB, 'B');
});

afterAll(async () => {
  const users = [contractorId, staffId, accountsId];
  await db.deleteFrom('audit_logs').where('user_id', 'in', users).execute();
  await db.deleteFrom('maintenance_work_orders').where('id', 'in', [woA, woB]).execute();
  await db.deleteFrom('files').where('id', 'in', [fileMine, fileOnMyOrder, fileOther]).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', users).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomA, roomB]).execute();
  await db.deleteFrom('buildings').where('id', 'in', [bldA, bldB]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propA, propB]).execute();
  await db.deleteFrom('users').where('id', 'in', users).execute();
});

describe('files: a contractor reads only their own work', () => {
  it('can read a file they uploaded, and the photo on an order assigned to them', async () => {
    asContractor();
    expect((await get(`/files/${fileMine}`)).status).toBe(200);
    expect((await get(`/files/${fileOnMyOrder}`)).status).toBe(200);
  });

  it('gets 404 (not 403) for anyone else’s file, by metadata and by download', async () => {
    asContractor();
    expect((await get(`/files/${fileOther}`)).status).toBe(404);
    expect((await get(`/files/${fileOther}/download`)).status).toBe(404);
  });

  it('staff are unaffected', async () => {
    asStaff();
    expect((await get(`/files/${fileOther}`)).status).toBe(200);
  });
});

describe('expenses: only spend in properties the user can access', () => {
  it('lists A’s repair cost and never B’s', async () => {
    asAccountsA();
    const res = await get('/expenses');
    expect(res.status).toBe(200);
    const ids = res.body.data.map((e: { id: string }) => e.id);
    expect(ids).toContain(woA);
    expect(ids).not.toContain(woB);
  });

  it('cannot approve B’s spend', async () => {
    asAccountsA();
    expect((await send('post', `/expenses/${woB}/approve`, {})).status).toBe(404);
    const row = await db.selectFrom('maintenance_work_orders').select('cost_approved_at').where('id', '=', woB).executeTakeFirstOrThrow();
    expect(row.cost_approved_at).toBeNull();
  });
});

describe('maintenance: a changed cost needs approving again', () => {
  it('PATCH with a new cost_amount clears the earlier sign-off', async () => {
    await db.updateTable('maintenance_work_orders')
      .set({ cost_approved_by: staffId, cost_approved_at: new Date() })
      .where('id', '=', woA).execute();
    asStaff();
    const res = await send('patch', `/maintenance/${woA}`, { cost_amount: 5_000_000 });
    expect(res.status).toBe(200);
    const row = await db.selectFrom('maintenance_work_orders')
      .select(['cost_amount', 'cost_approved_at', 'cost_approved_by']).where('id', '=', woA).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ cost_amount: 5_000_000, cost_approved_at: null, cost_approved_by: null });
  });

  it('an edit that leaves the cost alone keeps the sign-off', async () => {
    await db.updateTable('maintenance_work_orders')
      .set({ cost_approved_by: staffId, cost_approved_at: new Date() })
      .where('id', '=', woA).execute();
    asStaff();
    await send('patch', `/maintenance/${woA}`, { title: 'H6 A renamed', cost_amount: 5_000_000 });
    const row = await db.selectFrom('maintenance_work_orders').select('cost_approved_at').where('id', '=', woA).executeTakeFirstOrThrow();
    expect(row.cost_approved_at).not.toBeNull();
  });
});

describe('rooms: feed and QR tokens only for people who manage the unit', () => {
  it('hides both tokens without rooms.update', async () => {
    asAccountsA();
    const one = await get(`/rooms/${roomA}`);
    expect(one.status).toBe(200);
    expect(one.body).not.toHaveProperty('ical_token');
    expect(one.body).not.toHaveProperty('guest_qr_token');
    const list = await get('/rooms');
    expect(list.body.data.length).toBeGreaterThan(0);
    for (const r of list.body.data) {
      expect(r).not.toHaveProperty('ical_token');
      expect(r).not.toHaveProperty('guest_qr_token');
    }
  });

  it('shows them to rooms.update', async () => {
    asStaff();
    const one = await get(`/rooms/${roomA}`);
    expect(one.body.ical_token).toBeTruthy();
    expect(one.body.guest_qr_token).toBeTruthy();
  });
});

describe('bad input is a 400 in plain words, not a 500 with database text', () => {
  it('an id that is not a uuid', async () => {
    asStaff();
    const res = await get('/files/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.message).not.toMatch(/syntax|uuid/i);
  });

  it('a body that is not JSON', async () => {
    asStaff();
    const res = await request(app)
      .patch(`/maintenance/${woA}`)
      .set('Authorization', 'Bearer t')
      .set('X-Property-Id', propA)
      .set('Content-Type', 'application/json')
      .send('{"title": ');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/valid JSON/);
  });
});
