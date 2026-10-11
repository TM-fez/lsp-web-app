/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit 2026-10-11, M-3 / L-2) Every unclaimed Booking.com block points at ONE shared
 * placeholder contact (migration 047). The QR self check-in filled that placeholder's blanks
 * with the first guest's name, email and phone — after which every unclaimed OTA booking in
 * the estate showed that person. Now the guest gets their own record and only their booking
 * moves to it. And an email another guest already owns is noted for staff, never answered
 * with a 409 (which told a stranger the email belonged to a guest).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { PublicService } from '../../../src/modules/public/public.service.js';
import { PublicRepository } from '../../../src/modules/public/public.repository.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';
import { ContactsRepository } from '../../../src/modules/crm/contacts/contacts.repository.js';
import { LeadsRepository } from '../../../src/modules/crm/leads/leads.repository.js';
import { SYSTEM_OTA_CONTACT_ID } from '../../../src/modules/channel/channel.types.js';

const service = new PublicService(
  new PublicRepository(db),
  new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db), new PricingService(new PricingRepository(db))),
  new ContactsRepository(db),
  new LeadsRepository(db),
);

const day0 = new Date();
day0.setUTCHours(0, 0, 0, 0);
const offset = (n: number) => new Date(day0.getTime() + n * 86_400_000);
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let userId: string, propId: string, bldId: string;
let otaRoom: string, otaToken: string, otaRes: string;
let anonRoom: string, anonToken: string, anonContact: string, anonRes: string;
let owner: string;
const before: { name?: string; email?: string | null; phone?: string | null } = {};
const madeContacts: string[] = [];

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'M3', email: `m3-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `M3_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `M3B_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  const room = async (t: string) =>
    db.insertInto('rooms').values({ name: `M3 ${t}`, code: `M3-${t}-${uniq}`, building_id: bldId, created_by: userId, updated_by: userId })
      .returning(['id', 'guest_qr_token']).executeTakeFirstOrThrow();
  ({ id: otaRoom, guest_qr_token: otaToken } = await room('OTA'));
  ({ id: anonRoom, guest_qr_token: anonToken } = await room('ANON'));

  const sys = await db.selectFrom('contacts').select(['name', 'email', 'phone']).where('id', '=', SYSTEM_OTA_CONTACT_ID).executeTakeFirstOrThrow();
  Object.assign(before, sys);

  const stay = async (roomId: string, contactId: string) =>
    (await db.insertInto('reservations').values({
      contact_id: contactId, room_id: roomId, check_in_date: offset(-1), check_out_date: offset(2),
      status: 'BLOCKED', source: 'BOOKING_COM', external_uid: `m3-${roomId}`, created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
  otaRes = await stay(otaRoom, SYSTEM_OTA_CONTACT_ID);

  anonContact = (await db.insertInto('contacts').values({ type: 'individual', name: 'Walk-up guest', created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow()).id;
  anonRes = await stay(anonRoom, anonContact);
  owner = (await db.insertInto('contacts').values({ type: 'individual', name: `Owner ${uniq}`, email: `owner-${uniq}@t.local`, created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await db.deleteFrom('reservations').where('id', 'in', [otaRes, anonRes]).execute();
  await db.deleteFrom('audit_logs').where('entity_id', 'in', [otaRes, anonRes, anonContact, owner, ...madeContacts]).execute();
  await db.deleteFrom('contacts').where('id', 'in', [anonContact, owner, ...madeContacts]).execute();
  // Belt and braces: the placeholder must be exactly as it was.
  await db.updateTable('contacts').set(before as never).where('id', '=', SYSTEM_OTA_CONTACT_ID).execute();
  await db.deleteFrom('rooms').where('id', 'in', [otaRoom, anonRoom]).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Audit M-3 — QR check-in on an unclaimed Booking.com booking', () => {
  it('gives the guest their own record and never writes to the shared placeholder', async () => {
    await service.submitSelfCheckin(
      { token: otaToken, name: `Ana ${uniq}`, email: `ana-${uniq}@t.local`, phone: '+267 71 000 001' } as never,
      { ip: '1.1.1.1' },
    );
    const sys = await db.selectFrom('contacts').select(['name', 'email', 'phone']).where('id', '=', SYSTEM_OTA_CONTACT_ID).executeTakeFirstOrThrow();
    expect(sys).toEqual(before);

    const res = await db.selectFrom('reservations').select(['contact_id', 'self_checkin_at']).where('id', '=', otaRes).executeTakeFirstOrThrow();
    expect(res.contact_id).not.toBe(SYSTEM_OTA_CONTACT_ID);
    expect(res.self_checkin_at).not.toBeNull();
    madeContacts.push(res.contact_id);
    const guest = await db.selectFrom('contacts').select(['name', 'email', 'phone', 'email_shared']).where('id', '=', res.contact_id).executeTakeFirstOrThrow();
    expect(guest).toMatchObject({ name: `Ana ${uniq}`, email: `ana-${uniq}@t.local`, email_shared: false });
  });
});

describe('Audit L-2 — QR check-in never reveals whether an email is a guest’s', () => {
  it('notes an email another guest owns for staff, instead of failing with a 409', async () => {
    await expect(
      service.submitSelfCheckin(
        { token: anonToken, name: 'Walk-up guest', email: `owner-${uniq}@t.local` } as never,
        { ip: '1.1.1.1' },
      ),
    ).resolves.toBeDefined();
    const c = await db.selectFrom('contacts').select('email').where('id', '=', anonContact).executeTakeFirstOrThrow();
    expect(c.email).toBeNull();
    const r = await db.selectFrom('reservations').select('notes').where('id', '=', anonRes).executeTakeFirstOrThrow();
    expect(r.notes).toContain(`owner-${uniq}@t.local`);
  });
});
