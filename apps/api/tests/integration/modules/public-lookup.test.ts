/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * The public "manage my booking" lookup matches code + email. The email used to be
 * compared with ILIKE, where `_` and `%` are wildcards — and both are legal in an email —
 * so `__@domain` plus a guessed 6-hex code returned a stranger's booking (re-test 2026-10-04).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { PublicRepository } from '../../../src/modules/public/public.repository.js';

const repo = new PublicRepository(db);
const uniq = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const domain = `lookup-${uniq}.test`;
let userId: string, propId: string, buildingId: string, roomId: string, contactId: string, reservationId: string;
let code: string;

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'Lookup', email: `lookup-${uniq}@t.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `LK_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  buildingId = (await db.insertInto('buildings').values({ property_id: propId, name: `LKB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'LK', code: `LK-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow()).id;
  contactId = (await db.insertInto('contacts').values({ name: 'Lookup Guest', email: `ab@${domain}`, created_by: userId, updated_by: userId } as never)
    .returning('id').executeTakeFirstOrThrow()).id;
  reservationId = (await db.insertInto('reservations').values({
    contact_id: contactId, room_id: roomId, check_in_date: new Date('2034-02-01'), check_out_date: new Date('2034-02-03'),
    status: 'PENDING', source: 'WEBSITE', created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  code = reservationId.replace(/-/g, '').slice(0, 6);
});

afterAll(async () => {
  await db.deleteFrom('reservations').where('id', '=', reservationId).execute();
  await db.deleteFrom('contacts').where('id', '=', contactId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('public booking lookup', () => {
  it('finds the booking by the exact email, any letter case', async () => {
    expect((await repo.findWebsiteBookingByCode(code, `AB@${domain.toUpperCase()}`))?.id).toBe(reservationId);
  });

  it('treats _ and % in the typed email as plain characters, not wildcards', async () => {
    expect(await repo.findWebsiteBookingByCode(code, `__@${domain}`)).toBeUndefined();
    expect(await repo.findWebsiteBookingByCode(code, `%@${domain}`)).toBeUndefined();
    expect(await repo.findContactByEmail(`%@${domain}`)).toBeUndefined();
  });
});
