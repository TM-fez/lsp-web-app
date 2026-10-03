/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (P6) The Files library: every file categorised by what it is attached to, plus the
 * visibility rules — guest ID copies only with files.guest_documents.read (admin and
 * reception), contractors only their own work, other properties' documents never — and
 * filing a standalone upload under Contracts / Compliance / Other.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createFilesRouter } from '../../../src/modules/files/files.routes.js';
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
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let reception: string, accounts: string, contractor: string;
let propA: string, propB: string, bldA: string, bldB: string, roomA: string, roomB: string;
let contactId: string, reservationId: string, woId: string, invoiceId: string;
const f: Record<string, string> = {};

const READ = ['files.read', 'files.create'];
const as = (sub: string, role: string, permissions: string[]) => {
  mockState.user = { sub, role, permissions };
};
const asReception = () => as(reception, 'reception', [...READ, 'files.guest_documents.read']);
const asAccounts = () => as(accounts, 'accounts', READ);
const asContractor = () => as(contractor, 'contractor', READ);

const get = (path: string) => request(app).get(path).set('Authorization', 'Bearer t');
const ids = (res: request.Response) => (res.body.data as Array<{ id: string }>).map((r) => r.id);
const row = (res: request.Response, id: string) => (res.body.data as Array<{ id: string; category: string }>).find((r) => r.id === id);

async function file(tag: string, createdBy: string) {
  const r = await db.insertInto('files').values({
    original_name: `${tag}-${uniq}.pdf`, stored_name: `${tag}-${uniq}.pdf`, mime_type: 'application/pdf', extension: 'pdf',
    size_bytes: 10, checksum: `${tag}-${uniq}`, storage_driver: 'local', bucket: null, path: `/x/${tag}-${uniq}`,
    created_by: createdBy,
  } as never).returning('id').executeTakeFirstOrThrow();
  f[tag] = r.id;
  return r.id;
}

beforeAll(async () => {
  const roleId = async (n: string) => (await db.selectFrom('roles').select('id').where('name', '=', n).executeTakeFirstOrThrow()).id;
  const user = async (role: string) =>
    (await db.insertInto('users').values({ role_id: await roleId(role), name: `P6 ${role}`, email: `p6-${role}-${uniq}@t.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()).id;
  reception = await user('reception');
  accounts = await user('accounts');
  contractor = await user('contractor');

  const prop = async (t: string) => {
    const p = (await db.insertInto('properties').values({ name: `P6_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const b = (await db.insertInto('buildings').values({ property_id: p, name: `P6B_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const r = (await db.insertInto('rooms').values({ name: `P6 ${t}`, code: `P6-${t}-${uniq}`, building_id: b, created_by: reception, updated_by: reception })
      .returning('id').executeTakeFirstOrThrow()).id;
    return { p, b, r };
  };
  ({ p: propA, b: bldA, r: roomA } = await prop('A'));
  ({ p: propB, b: bldB, r: roomB } = await prop('B'));
  // Reception and accounts belong to A only; the contractor to A.
  await db.insertInto('user_properties').values([
    { user_id: reception, property_id: propA },
    { user_id: accounts, property_id: propA },
    { user_id: contractor, property_id: propA },
  ]).execute();

  contactId = (await db.insertInto('contacts').values({ name: `P6 Guest ${uniq}`, created_by: reception, updated_by: reception })
    .returning('id').executeTakeFirstOrThrow()).id;

  await file('passport', reception);
  await file('receipt', reception);
  await file('repair', contractor);
  await file('unitphoto', reception);
  await file('otherprop', reception);
  await file('standalone', accounts);
  await file('contractorstray', reception);

  reservationId = (await db.insertInto('reservations').values({
    contact_id: contactId, room_id: roomA, check_in_date: new Date('2033-01-10'), check_out_date: new Date('2033-01-12'),
    status: 'PENDING', source: 'DIRECT', created_by: reception, updated_by: reception, document_file_id: f.passport,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  invoiceId = (await db.insertInto('invoices').values({
    number: `P6-${uniq}`, reservation_id: reservationId, kind: 'DEPOSIT', status: 'PAID', subtotal_amount: 1, tax_rate_bps: 0, tax_amount: 0,
    total_amount: 1, issued_by: reception, created_by: reception, updated_by: reception, receipt_file_id: f.receipt,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  woId = (await db.insertInto('maintenance_work_orders').values({
    room_id: roomA, title: 'P6 leak', priority: 'MEDIUM', status: 'OPEN', reported_by: reception, assigned_to: contractor, before_file_id: f.repair,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  await db.updateTable('rooms').set({ image_file_id: f.unitphoto } as never).where('id', '=', roomA).execute();
  // A unit photo for ANOTHER property this staff member does not belong to.
  await db.updateTable('rooms').set({ image_file_id: f.otherprop } as never).where('id', '=', roomB).execute();
});

afterAll(async () => {
  const users = [reception, accounts, contractor];
  await db.updateTable('rooms').set({ image_file_id: null } as never).where('id', 'in', [roomA, roomB]).execute();
  await db.deleteFrom('maintenance_work_orders').where('id', '=', woId).execute();
  await db.deleteFrom('invoices').where('id', '=', invoiceId).execute();
  await db.deleteFrom('reservations').where('id', '=', reservationId).execute();
  await db.deleteFrom('contacts').where('id', '=', contactId).execute();
  await db.deleteFrom('files').where('id', 'in', Object.values(f)).execute();
  await db.deleteFrom('audit_logs').where('user_id', 'in', users).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', users).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomA, roomB]).execute();
  await db.deleteFrom('buildings').where('id', 'in', [bldA, bldB]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propA, propB]).execute();
  await db.deleteFrom('users').where('id', 'in', users).execute();
});

describe('P6 Files library', () => {
  it('categorises each file by what it is attached to, and names the record', async () => {
    asReception();
    const res = await get(`/files/library?search=${uniq}&limit=100`);
    expect(res.status).toBe(200);
    expect(row(res, f.passport)).toMatchObject({ category: 'GUEST_DOCUMENTS', link_kind: 'reservation', link_label: `P6 Guest ${uniq}`, property_id: propA });
    expect(row(res, f.receipt)).toMatchObject({ category: 'INCOME_RECEIPTS', link_kind: 'invoice', link_label: `P6-${uniq}` });
    expect(row(res, f.repair)).toMatchObject({ category: 'REPAIR_PHOTOS', link_kind: 'work_order', link_label: 'P6 leak' });
    expect(row(res, f.unitphoto)).toMatchObject({ category: 'UNIT_PHOTOS', link_kind: 'room' });
    expect(row(res, f.standalone)).toMatchObject({ category: 'UNFILED', link_kind: null });
  });

  it('never shows another property’s documents', async () => {
    asReception();
    expect(ids(await get(`/files/library?search=${uniq}&limit=100`))).not.toContain(f.otherprop);
    expect((await get(`/files/${f.otherprop}`)).status).toBe(404);
  });

  it('hides guest ID copies without files.guest_documents.read — in the list AND by id', async () => {
    asAccounts();
    const res = await get(`/files/library?search=${uniq}&limit=100`);
    expect(ids(res)).not.toContain(f.passport);
    expect(ids(res)).toContain(f.receipt);
    expect((await get(`/files/${f.passport}`)).status).toBe(404);
    expect((await get(`/files/${f.passport}/download`)).status).toBe(404);
  });

  it('shows a contractor only their own uploads and their jobs’ photos', async () => {
    asContractor();
    const res = await get(`/files/library?search=${uniq}&limit=100`);
    expect(ids(res).sort()).toEqual([f.repair].sort());
    expect((await get(`/files/${f.contractorstray}`)).status).toBe(404);
  });

  it('filters by category', async () => {
    asReception();
    const res = await get(`/files/library?category=REPAIR_PHOTOS&search=${uniq}`);
    expect(ids(res)).toEqual([f.repair]);
  });

  it('files a standalone upload under Contracts, with a property — and it then lists there', async () => {
    asAccounts();
    const res = await request(app).patch(`/files/${f.standalone}/classify`).set('Authorization', 'Bearer t')
      .send({ category: 'CONTRACTS', property_id: propA });
    expect(res.status).toBe(200);
    const list = await get(`/files/library?category=CONTRACTS&search=${uniq}`);
    expect(row(list, f.standalone)).toMatchObject({ category: 'CONTRACTS', property_id: propA });
  });

  it('refuses to relabel a linked file (a passport copy cannot become “Other”)', async () => {
    asReception();
    const res = await request(app).patch(`/files/${f.passport}/classify`).set('Authorization', 'Bearer t')
      .send({ category: 'OTHER', property_id: null });
    expect(res.status).toBe(409);
  });

  it('only the uploader (or a file manager) may file a document', async () => {
    asReception(); // standalone was uploaded by accounts; reception lacks files.delete
    const res = await request(app).patch(`/files/${f.standalone}/classify`).set('Authorization', 'Bearer t')
      .send({ category: 'OTHER', property_id: null });
    expect(res.status).toBe(403);
  });
});
