/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the P5.1 in-apartment QR self check-in: the per-unit token resolves to the
 * guest physically in the unit today, and the guest's own details enrich that stay's
 * CRM contact (turning an anonymous OTA block into a re-bookable contact) and stamp
 * the stay. Fixtures are self-created; assertions read back the specific rows.
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

const rooms = new RoomsRepository(db);
const service = new PublicService(
  new PublicRepository(db),
  new ReservationsService(new ReservationsRepository(db), rooms, new PricingService(new PricingRepository(db))),
  new ContactsRepository(db),
);

const day0 = new Date();
day0.setUTCHours(0, 0, 0, 0);
const offset = (n: number) => new Date(day0.getTime() + n * 86_400_000);

let userId: string;
let propId: string;
let buildingId: string;
let stayRoomId: string;   // has a guest in-house today
let emptyRoomId: string;  // no stay
let stayToken: string;
let emptyToken: string;
let contactId: string;
let reservationId: string;
let propName: string;

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  propName = `CHK_${uniq}`;
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const user = await db.insertInto('users')
    .values({ role_id: role.id, name: 'Checkin Test', email: `checkin-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow();
  userId = user.id;

  const prop = await db.insertInto('properties').values({ name: propName }).returning('id').executeTakeFirstOrThrow();
  propId = prop.id;
  const building = await db.insertInto('buildings').values({ property_id: propId, name: `CHK_B_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  buildingId = building.id;

  const roomRows = await db.insertInto('rooms')
    .values([
      { name: 'Stay Unit', code: `CHK-S-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId },
      { name: 'Empty Unit', code: `CHK-E-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId },
    ])
    .returning(['id', 'name', 'guest_qr_token']).execute();
  const stayRoom = roomRows.find((r) => r.name === 'Stay Unit')!;
  const emptyRoom = roomRows.find((r) => r.name === 'Empty Unit')!;
  stayRoomId = stayRoom.id; stayToken = stayRoom.guest_qr_token;
  emptyRoomId = emptyRoom.id; emptyToken = emptyRoom.guest_qr_token;

  // An anonymous OTA-style guest currently in-house (window covers today).
  const contact = await db.insertInto('contacts')
    .values({ type: 'individual', name: 'Booking.com Guest', created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow();
  contactId = contact.id;
  const res = await db.insertInto('reservations')
    .values({
      contact_id: contactId, room_id: stayRoomId, check_in_date: offset(-1), check_out_date: offset(3),
      status: 'BLOCKED', created_by: userId, updated_by: userId,
    })
    .returning('id').executeTakeFirstOrThrow();
  reservationId = res.id;
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('entity_id', '=', contactId).execute();
  await db.deleteFrom('reservations').where('id', '=', reservationId).execute();
  await db.deleteFrom('contacts').where('id', '=', contactId).execute();
  await db.deleteFrom('rooms').where('id', 'in', [stayRoomId, emptyRoomId]).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Guest self check-in (live DB)', () => {
  it('reads a unit’s stay context from its QR token without leaking guest PII', async () => {
    const info = await service.getCheckinInfo(stayToken);
    expect(info).toMatchObject({ property_name: propName, unit_name: 'Stay Unit', has_stay: true, already_checked_in: false });
    expect(info.check_out_date).toBe(offset(3).toISOString().slice(0, 10));
    // No field carries the current guest's name/email/phone.
    expect(JSON.stringify(info)).not.toContain('Booking.com Guest');
  });

  it('captures the guest’s own details into the stay’s CRM contact', async () => {
    const out = await service.submitSelfCheckin(
      { token: stayToken, name: 'Neo Kgosi', email: 'neo@real.example', phone: '+267 71 234 567' },
      { ip: '203.0.113.9' },
    );
    expect(out.unit_name).toBe('Stay Unit');

    const contact = await db.selectFrom('contacts').selectAll().where('id', '=', contactId).executeTakeFirstOrThrow();
    expect(contact.name).toBe('Neo Kgosi');
    expect(contact.email).toBe('neo@real.example');
    expect(contact.phone).toBe('+267 71 234 567');

    const res = await db.selectFrom('reservations').select('self_checkin_at').where('id', '=', reservationId).executeTakeFirstOrThrow();
    expect(res.self_checkin_at).not.toBeNull();
  });

  it('reports already-checked-in once the guest has confirmed', async () => {
    const info = await service.getCheckinInfo(stayToken);
    expect(info.already_checked_in).toBe(true);
  });

  it('rejects an unknown token', async () => {
    await expect(service.getCheckinInfo('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/not recognised/i);
  });

  it('has no stay for a unit that is empty today, and refuses to capture', async () => {
    const info = await service.getCheckinInfo(emptyToken);
    expect(info).toMatchObject({ unit_name: 'Empty Unit', has_stay: false, check_out_date: null });
    await expect(
      service.submitSelfCheckin({ token: emptyToken, name: 'Nobody', email: 'no@one.example' }, {}),
    ).rejects.toThrow(/no active stay/i);
  });
});
