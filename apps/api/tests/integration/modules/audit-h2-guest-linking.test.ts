/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit 2026-10-11, H-2) A staff member limited to property A could reach a guest booked
 * only at property B in two steps: the Files library listed every pictured guest in the
 * estate (name + id), and any booking or enquiry accepted that id as its guest, billing
 * contact or coordinator — after which the guest counted as "booked at A" and the full
 * record opened. Both steps are closed; these tests pin them.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createFilesRouter } from '../../../src/modules/files/files.routes.js';
import { createReservationsRouter } from '../../../src/modules/reservations/reservations.routes.js';
import { createLeadsRouter } from '../../../src/modules/crm/leads/leads.routes.js';
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
app.use('/reservations', createReservationsRouter());
app.use('/leads', createLeadsRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let staff: string, admin: string;
let propA: string, propB: string, bldA: string, bldB: string, roomA: string, roomA2: string, roomB: string;
let guestA: string, guestB: string, avatarA: string, avatarB: string;
let bookingA: string;
const resIds: string[] = [];
const leadIds: string[] = [];

const PERMS = [
  'files.read', 'files.library', 'reservations.read', 'reservations.create', 'reservations.update',
  'crm.leads.read', 'crm.leads.create', 'crm.leads.update',
];
const asStaff = () => { mockState.user = { sub: staff, role: 'reception', permissions: PERMS }; };
const asAdmin = () => { mockState.user = { sub: admin, role: 'admin', permissions: PERMS }; };
const call = (method: 'get' | 'post' | 'patch', path: string, property = propA) =>
  request(app)[method](path).set('Authorization', 'Bearer t').set('x-property-id', property);
const ids = (res: request.Response) => (res.body.data as Array<{ id: string }>).map((r) => r.id);

async function avatarFile(tag: string, createdBy: string) {
  return (await db.insertInto('files').values({
    original_name: `${tag}-${uniq}.png`, stored_name: `${tag}-${uniq}.png`, mime_type: 'image/png', extension: 'png',
    size_bytes: 10, checksum: `${tag}-${uniq}`, storage_driver: 'local', bucket: null, path: `/x/${tag}-${uniq}`,
    created_by: createdBy,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
}

beforeAll(async () => {
  const roleId = async (n: string) => (await db.selectFrom('roles').select('id').where('name', '=', n).executeTakeFirstOrThrow()).id;
  const user = async (role: string, tag: string) =>
    (await db.insertInto('users').values({ role_id: await roleId(role), name: `H2 ${tag}`, email: `h2-${tag}-${uniq}@t.local`, password_hash: 'x' })
      .returning('id').executeTakeFirstOrThrow()).id;
  staff = await user('reception', 'staff');
  admin = await user('admin', 'admin');

  const room = async (b: string, t: string) =>
    (await db.insertInto('rooms').values({ name: `H2 ${t}`, code: `H2-${t}-${uniq}`, building_id: b, created_by: admin, updated_by: admin })
      .returning('id').executeTakeFirstOrThrow()).id;
  const prop = async (t: string) => {
    const p = (await db.insertInto('properties').values({ name: `H2_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const b = (await db.insertInto('buildings').values({ property_id: p, name: `H2B_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    return { p, b, r: await room(b, t) };
  };
  ({ p: propA, b: bldA, r: roomA } = await prop('A'));
  ({ p: propB, b: bldB, r: roomB } = await prop('B'));
  roomA2 = await room(bldA, 'A2');
  await db.insertInto('user_properties').values({ user_id: staff, property_id: propA }).execute();

  avatarA = await avatarFile('avatarA', admin);
  avatarB = await avatarFile('avatarB', admin);
  const contact = async (tag: string, avatar: string) =>
    (await db.insertInto('contacts').values({ name: `H2 ${tag} ${uniq}`, avatar_file_id: avatar, created_by: admin, updated_by: admin } as never)
      .returning('id').executeTakeFirstOrThrow()).id;
  guestA = await contact('GuestA', avatarA);
  guestB = await contact('GuestB', avatarB);

  const book = async (contactId: string, roomId: string, from: string, to: string) => {
    const id = (await db.insertInto('reservations').values({
      contact_id: contactId, room_id: roomId, check_in_date: new Date(from), check_out_date: new Date(to),
      status: 'PENDING', source: 'DIRECT', created_by: admin, updated_by: admin,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
    resIds.push(id);
    return id;
  };
  bookingA = await book(guestA, roomA, '2034-03-01', '2034-03-03');
  await book(guestB, roomB, '2034-03-01', '2034-03-03'); // guest B: booked only at property B
});

afterAll(async () => {
  const users = [staff, admin];
  await db.deleteFrom('leads').where('id', 'in', leadIds.length ? leadIds : ['00000000-0000-4000-a000-000000000000']).execute();
  await db.deleteFrom('reservations').where('room_id', 'in', [roomA, roomA2, roomB]).execute();
  await db.deleteFrom('contacts').where('id', 'in', [guestA, guestB]).execute();
  await db.deleteFrom('files').where('id', 'in', [avatarA, avatarB]).execute();
  await db.deleteFrom('audit_logs').where('user_id', 'in', users).execute();
  await db.deleteFrom('user_properties').where('user_id', 'in', users).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomA, roomA2, roomB]).execute();
  await db.deleteFrom('buildings').where('id', 'in', [bldA, bldB]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propA, propB]).execute();
  await db.deleteFrom('users').where('id', 'in', users).execute();
});

describe('Audit H-2 — the Files library no longer lists other properties’ guests', () => {
  it('shows a limited user the pictures of their own guests only', async () => {
    asStaff();
    const res = await call('get', `/files/library?category=PROFILE_PICTURES&search=${uniq}&limit=100`);
    expect(res.status).toBe(200);
    expect(ids(res)).toContain(avatarA);
    expect(ids(res)).not.toContain(avatarB);
    expect((await call('get', `/files/${avatarB}`)).status).toBe(404);
  });

  it('still shows an admin every guest picture', async () => {
    asAdmin();
    const res = await call('get', `/files/library?category=PROFILE_PICTURES&search=${uniq}&limit=100`);
    expect(ids(res)).toEqual(expect.arrayContaining([avatarA, avatarB]));
  });
});

describe('Audit H-2 — a guest you can’t see can’t be linked', () => {
  const stay = { room_id: '', check_in_date: '2034-05-01', check_out_date: '2034-05-03' };

  it('refuses another property’s guest as the guest, billing contact or coordinator of a new booking', async () => {
    asStaff();
    for (const field of ['contact_id', 'billing_contact_id', 'booking_coordinator_id'] as const) {
      const body = { ...stay, room_id: roomA2, contact_id: guestA, [field]: guestB };
      const res = await call('post', '/reservations').send(body);
      expect(res.status, field).toBe(400);
      expect(res.body.message).toMatch(/isn’t in your guest list/);
    }
  });

  it('still books a guest you can see', async () => {
    asStaff();
    const res = await call('post', '/reservations').send({ ...stay, room_id: roomA2, contact_id: guestA });
    expect(res.status).toBe(201);
    resIds.push(res.body.id);
  });

  it('refuses switching an existing booking to another property’s guest, but re-saving it is fine', async () => {
    asStaff();
    expect((await call('patch', `/reservations/${bookingA}`).send({ billing_contact_id: guestB })).status).toBe(400);
    expect((await call('patch', `/reservations/${bookingA}`).send({ contact_id: guestB })).status).toBe(400);
    // The drawer re-sends the guest already on the booking — never refused.
    expect((await call('patch', `/reservations/${bookingA}`).send({ contact_id: guestA, notes: 'h2' })).status).toBe(200);
  });

  it('refuses linking another property’s guest to an enquiry', async () => {
    asStaff();
    const res = await call('post', '/leads').send({ title: `H2 lead ${uniq}`, contact_id: guestB });
    expect(res.status).toBe(400);
    const ok = await call('post', '/leads').send({ title: `H2 lead ok ${uniq}`, contact_id: guestA });
    expect(ok.status).toBe(201);
    leadIds.push(ok.body.id);
    expect((await call('patch', `/leads/${ok.body.id}`).send({ contact_id: guestB })).status).toBe(400);
  });

  it('lets an admin link any guest', async () => {
    asAdmin();
    const res = await call('post', '/reservations').send({ ...stay, room_id: roomA2, check_in_date: '2034-06-01', check_out_date: '2034-06-03', contact_id: guestA, billing_contact_id: guestB });
    expect(res.status).toBe(201);
    resIds.push(res.body.id);
  });
});
