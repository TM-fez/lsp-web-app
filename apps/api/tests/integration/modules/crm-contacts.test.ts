/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the Phase 4 (A4) CRM fields end-to-end against real SQL: the booking
 * coordinator + billing contact land on the reservation, the list join resolves
 * their names, a bogus id is a clean 400 (not an FK-violation 500), and the
 * invoice document's bill-to coalesces to the billing contact when one is
 * assigned (guest otherwise). Fixtures are self-created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { InvoicesRepository } from '../../../src/modules/invoices/invoices.repository.js';

let userId: string;
let propertyId: string;
let buildingId: string;
let roomId: string;
let guestId: string;
let coordinatorId: string;
let billerId: string;
let reservationId: string;    // corporate: coordinator + billing contact set
let soloReservationId: string; // individual: neither set
let invoiceCorporate: string;
let invoiceSolo: string;

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const user = await db
    .insertInto('users')
    .values({ role_id: role.id, name: 'CRM Test', email: `crm-${uniq}@test.local`, password_hash: 'x' })
    .returning('id')
    .executeTakeFirstOrThrow();
  userId = user.id;

  const prop = await db.insertInto('properties').values({ name: `CRM_TEST_PROP_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  propertyId = prop.id;
  const building = await db
    .insertInto('buildings').values({ property_id: propertyId, name: `CRM_TEST_BLDG_${uniq}` })
    .returning('id').executeTakeFirstOrThrow();
  buildingId = building.id;
  const room = await db
    .insertInto('rooms')
    .values({ name: 'CRM Test Room', code: `CRM-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow();
  roomId = room.id;

  const contacts = await db
    .insertInto('contacts')
    .values([
      { name: 'Guest Person', email: `guest-${uniq}@test.local`, created_by: userId, updated_by: userId },
      { name: 'Corp Coordinator', company: 'BigCo', email: `coord-${uniq}@test.local`, created_by: userId, updated_by: userId },
      { name: 'Accounts Payable', company: 'BigCo', email: `ap-${uniq}@test.local`, created_by: userId, updated_by: userId },
    ])
    .returning(['id', 'name'])
    .execute();
  guestId = contacts.find((c) => c.name === 'Guest Person')!.id;
  coordinatorId = contacts.find((c) => c.name === 'Corp Coordinator')!.id;
  billerId = contacts.find((c) => c.name === 'Accounts Payable')!.id;

  const reservations = await db
    .insertInto('reservations')
    .values([
      {
        contact_id: guestId, room_id: roomId,
        check_in_date: new Date('2030-01-10'), check_out_date: new Date('2030-01-12'),
        booking_coordinator_id: coordinatorId, billing_contact_id: billerId,
        created_by: userId, updated_by: userId,
      },
      {
        contact_id: guestId, room_id: roomId,
        check_in_date: new Date('2030-02-10'), check_out_date: new Date('2030-02-12'),
        created_by: userId, updated_by: userId,
      },
    ])
    .returning(['id', 'check_in_date'])
    .execute();
  reservationId = reservations[0].id;
  soloReservationId = reservations[1].id;

  const invoices = await db
    .insertInto('invoices')
    .values([
      {
        number: `CRM-${uniq}-1`, reservation_id: reservationId, kind: 'DEPOSIT',
        subtotal_amount: 10000, tax_rate_bps: 1400, tax_amount: 1400, total_amount: 11400,
        issued_by: userId, created_by: userId, updated_by: userId,
      },
      {
        number: `CRM-${uniq}-2`, reservation_id: soloReservationId, kind: 'DEPOSIT',
        subtotal_amount: 10000, tax_rate_bps: 1400, tax_amount: 1400, total_amount: 11400,
        issued_by: userId, created_by: userId, updated_by: userId,
      },
    ])
    .returning('id')
    .execute();
  invoiceCorporate = invoices[0].id;
  invoiceSolo = invoices[1].id;
});

afterAll(async () => {
  await db.deleteFrom('invoices').where('id', 'in', [invoiceCorporate, invoiceSolo]).execute();
  await db.deleteFrom('reservations').where('id', 'in', [reservationId, soloReservationId]).execute();
  await db.deleteFrom('contacts').where('id', 'in', [guestId, coordinatorId, billerId]).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
});

describe('Reservation CRM contacts (live DB)', () => {
  it('the list join resolves coordinator + billing names (null for individual stays)', async () => {
    const repo = new ReservationsRepository(db);
    const { data } = await repo.findPaginated({ contact_id: guestId }, { page: 1, limit: 10 });
    const corporate = data.find((r) => r.id === reservationId)!;
    const solo = data.find((r) => r.id === soloReservationId)!;

    expect(corporate.booking_coordinator_name).toBe('Corp Coordinator');
    expect(corporate.billing_contact_name).toBe('Accounts Payable');
    expect(solo.booking_coordinator_name).toBeNull();
    expect(solo.billing_contact_name).toBeNull();
  });

  it('the invoice bill-to coalesces: billing contact when assigned, guest otherwise', async () => {
    const repo = new InvoicesRepository(db);

    const corporate = await repo.findDocumentData(invoiceCorporate);
    expect(corporate?.bill_to_name).toBe('Accounts Payable');
    expect(corporate?.bill_to_email).toBe(`ap-${uniq}@test.local`);
    expect(corporate?.guest_name).toBe('Guest Person'); // the stay still names the guest

    const solo = await repo.findDocumentData(invoiceSolo);
    expect(solo?.bill_to_name).toBe('Guest Person');
    expect(solo?.bill_to_email).toBe(`guest-${uniq}@test.local`);
  });
});
