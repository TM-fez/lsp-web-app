/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the CRM lead → booking conversion: an enquiry becomes a PENDING reservation
 * for its guest (source mapped from the lead's channel), and the lead is marked
 * CONVERTED and linked. Guards: no double-convert, no convert without a guest, no
 * convert of a lost enquiry. Fixtures are self-created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { LeadsService } from '../../../src/modules/crm/leads/leads.service.js';
import { LeadsRepository } from '../../../src/modules/crm/leads/leads.repository.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';

const service = new LeadsService(
  new LeadsRepository(db),
  new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db), new PricingService(new PricingRepository(db))),
);

const day0 = new Date();
day0.setUTCHours(0, 0, 0, 0);
const inDays = (n: number) => new Date(day0.getTime() + n * 86_400_000);

let userId: string;
let propId: string;
let buildingId: string;
let roomId: string;
let contactId: string;
let leadLinked: string;   // QUALIFIED, has contact + WHATSAPP source
let leadNoContact: string;// NEW, no contact
let leadLost: string;     // LOST
let createdReservationId: string | undefined;
const meta = () => ({ userId, ip: '203.0.113.5' });

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const user = await db.insertInto('users')
    .values({ role_id: role.id, name: 'Convert Test', email: `conv-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow();
  userId = user.id;

  const prop = await db.insertInto('properties').values({ name: `CONV_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  propId = prop.id;
  const building = await db.insertInto('buildings').values({ property_id: propId, name: `CONV_B_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  buildingId = building.id;
  const room = await db.insertInto('rooms').values({ name: 'Conv Unit', code: `CV-1-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow();
  roomId = room.id;
  const contact = await db.insertInto('contacts').values({ type: 'individual', name: 'Kefilwe Moeng', created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow();
  contactId = contact.id;

  const leads = await db.insertInto('leads')
    .values([
      { title: '2-bed for August', status: 'QUALIFIED', source: 'WHATSAPP', contact_id: contactId, created_by: userId, updated_by: userId },
      { title: 'Walk-in, no details', status: 'NEW', created_by: userId, updated_by: userId },
      { title: 'Went elsewhere', status: 'LOST', contact_id: contactId, created_by: userId, updated_by: userId },
    ])
    .returning(['id', 'title']).execute();
  leadLinked = leads.find((l) => l.title.startsWith('2-bed'))!.id;
  leadNoContact = leads.find((l) => l.title.startsWith('Walk-in'))!.id;
  leadLost = leads.find((l) => l.title.startsWith('Went'))!.id;
});

afterAll(async () => {
  // Leads first — a converted lead's converted_reservation_id FKs the reservation.
  await db.deleteFrom('leads').where('id', 'in', [leadLinked, leadNoContact, leadLost]).execute();
  if (createdReservationId) await db.deleteFrom('reservations').where('id', '=', createdReservationId).execute();
  await db.deleteFrom('contacts').where('id', '=', contactId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Lead → booking conversion (live DB)', () => {
  it('creates a PENDING reservation for the lead’s guest and marks the lead converted', async () => {
    const { reservation, lead } = await service.convertLead(
      leadLinked,
      { room_id: roomId, check_in_date: inDays(2), check_out_date: inDays(5) },
      meta(),
      propId,
    );
    createdReservationId = reservation.id;

    expect(reservation.status).toBe('PENDING');           // commercial invariant
    expect(reservation.contact_id).toBe(contactId);
    expect(reservation.room_id).toBe(roomId);
    expect(reservation.source).toBe('PHONE');             // WHATSAPP → PHONE

    expect(lead.status).toBe('CONVERTED');
    expect(lead.converted_reservation_id).toBe(reservation.id);
    expect(lead.contact_id).toBe(contactId);
  });

  it('refuses to convert the same enquiry twice', async () => {
    await expect(
      service.convertLead(leadLinked, { room_id: roomId, check_in_date: inDays(8), check_out_date: inDays(10) }, meta(), propId),
    ).rejects.toThrow(/already been converted/i);
  });

  it('refuses to convert without a guest', async () => {
    await expect(
      service.convertLead(leadNoContact, { room_id: roomId, check_in_date: inDays(8), check_out_date: inDays(10) }, meta(), propId),
    ).rejects.toThrow(/choose a guest/i);
  });

  it('refuses to convert a lost enquiry', async () => {
    await expect(
      service.convertLead(leadLost, { room_id: roomId, check_in_date: inDays(8), check_out_date: inDays(10) }, meta(), propId),
    ).rejects.toThrow(/lost/i);
  });
});
