/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, N-4) A CBD-only user could DELETE any property's file by id (the route only
 * checked the files.delete permission), and could read, download and file documents that
 * belong to no property — the Village's unfiled uploads and contracts — because "no
 * property" was treated as house-wide.
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
let cbdUser: string, villageUser: string;
let propCbd: string, propVillage: string;
const f: Record<string, string> = {};
const users: string[] = [];

const PERMS = ['files.read', 'files.create', 'files.delete', 'files.library'];
const asCbd = () => { mockState.user = { sub: cbdUser, role: 'operations', permissions: PERMS }; };
const asAdmin = () => { mockState.user = { sub: cbdUser, role: 'admin', permissions: PERMS }; };
const call = (method: 'get' | 'patch' | 'delete', path: string, body?: object) =>
  request(app)[method](path).set('Authorization', 'Bearer t').send(body);

async function file(tag: string, createdBy: string, extra: Record<string, unknown> = {}) {
  f[tag] = (await db.insertInto('files').values({
    original_name: `${tag}-${uniq}.pdf`, stored_name: `${tag}-${uniq}.pdf`, mime_type: 'application/pdf', extension: 'pdf',
    size_bytes: 10, checksum: `${tag}-${uniq}`, storage_driver: 'local', bucket: null, path: `/x/${tag}-${uniq}`,
    created_by: createdBy, ...extra,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
}
const live = async (id: string) =>
  (await db.selectFrom('files').select('deleted_at').where('id', '=', id).executeTakeFirstOrThrow()).deleted_at === null;
const libraryIds = async () =>
  ((await call('get', `/files/library?search=${uniq}&limit=100`)).body.data as Array<{ id: string }>).map((r) => r.id);

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'operations').executeTakeFirstOrThrow()).id;
  const mk = async (t: string) => {
    const id = (await db.insertInto('users').values({ role_id: role, name: `F4 ${t}`, email: `f4-${t}-${uniq}@t.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()).id;
    users.push(id);
    return id;
  };
  cbdUser = await mk('cbd');
  villageUser = await mk('village');
  propCbd = (await db.insertInto('properties').values({ name: `F4_CBD_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  propVillage = (await db.insertInto('properties').values({ name: `F4_VIL_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  await db.insertInto('user_properties').values([
    { user_id: cbdUser, property_id: propCbd },
    { user_id: villageUser, property_id: propVillage },
  ]).execute();
  await file('villageContract', villageUser, { category: 'CONTRACTS', property_id: propVillage });
  await file('cbdContract', cbdUser, { category: 'CONTRACTS', property_id: propCbd });
  await file('villageUnfiled', villageUser);                                   // no category, no property
  await file('villageNoPropContract', villageUser, { category: 'CONTRACTS' }); // filed, but under "no property"
  await file('ownUnfiled', cbdUser);
  await file('toDelete', cbdUser, { category: 'OTHER', property_id: propCbd });
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', 'in', users).execute();
  await db.deleteFrom('files').where('id', 'in', Object.values(f)).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', users).execute();
  await db.deleteFrom('users').where('id', 'in', users).execute();
  await db.deleteFrom('properties').where('id', 'in', [propCbd, propVillage]).execute();
});

describe('DELETE /files/:id is property-scoped', () => {
  it('a CBD-only user cannot delete a Village file — 404, and the file survives', async () => {
    asCbd();
    expect((await call('delete', `/files/${f.villageContract}`)).status).toBe(404);
    expect(await live(f.villageContract)).toBe(true);
  });

  it('cannot delete someone else’s unfiled upload either', async () => {
    asCbd();
    expect((await call('delete', `/files/${f.villageUnfiled}`)).status).toBe(404);
    expect(await live(f.villageUnfiled)).toBe(true);
  });

  it('can still delete their own property’s file (soft delete, audited)', async () => {
    asCbd();
    expect((await call('delete', `/files/${f.toDelete}`)).status).toBe(204);
    expect(await live(f.toDelete)).toBe(false);
  });

  it('an admin can delete any property’s file', async () => {
    asAdmin();
    await file('adminDeletes', villageUser, { category: 'OTHER', property_id: propVillage });
    expect((await call('delete', `/files/${f.adminDeletes}`)).status).toBe(204);
  });
});

describe('files that belong to no property', () => {
  it('a CBD-only user does not see another person’s unfiled or "no property" documents in the library', async () => {
    asCbd();
    const ids = await libraryIds();
    expect(ids).toContain(f.cbdContract);
    expect(ids).toContain(f.ownUnfiled);
    expect(ids).not.toContain(f.villageContract);
    expect(ids).not.toContain(f.villageUnfiled);
    expect(ids).not.toContain(f.villageNoPropContract);
  });

  it('cannot read or download them by id', async () => {
    asCbd();
    for (const id of [f.villageUnfiled, f.villageNoPropContract]) {
      expect((await call('get', `/files/${id}`)).status).toBe(404);
      expect((await call('get', `/files/${id}/download`)).status).toBe(404);
    }
  });

  it('cannot classify them', async () => {
    asCbd();
    const res = await call('patch', `/files/${f.villageUnfiled}/classify`, { category: 'OTHER', property_id: propCbd });
    expect(res.status).toBe(404);
    const row = await db.selectFrom('files').select(['category', 'property_id']).where('id', '=', f.villageUnfiled).executeTakeFirstOrThrow();
    expect(row).toEqual({ category: null, property_id: null });
  });

  it('an all-property user (admin) sees them all', async () => {
    asAdmin();
    const ids = await libraryIds();
    expect(ids).toEqual(expect.arrayContaining([f.villageUnfiled, f.villageNoPropContract, f.villageContract, f.cbdContract]));
  });
});

describe('filing my own upload', () => {
  it('cannot put it under a property I do not work in', async () => {
    asCbd();
    const res = await call('patch', `/files/${f.ownUnfiled}/classify`, { category: 'OTHER', property_id: propVillage });
    expect(res.status).toBe(403);
  });

  it('can file it under my own property', async () => {
    asCbd();
    const res = await call('patch', `/files/${f.ownUnfiled}/classify`, { category: 'OTHER', property_id: propCbd });
    expect(res.status).toBe(200);
  });
});
