/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R5 NEW-6, found again in R6) "Remove" on a CANCELLED booking that still held the guest's
 * PAID money returned 204 and took the booking out of /finance/cancelled-with-money — while
 * its PAID receipt stayed in /invoices with nothing to explain it. Money held must be dealt
 * with (refunded, or kept with a reason on the booking) before the booking can disappear.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, guestId: string, propId: string, bldId: string, roomId: string;
const resIds: string[] = [], invIds: string[] = [];
const service = () => new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db));
const meta = () => ({ userId });

async function cancelled(from: string, to: string, paid: number) {
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, check_in_date: new Date(from), check_out_date: new Date(to),
    status: 'CANCELLED', source: 'DIRECT', created_by: userId, updated_by: userId, folio_total_amount: 100_000,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  resIds.push(id);
  if (paid > 0) {
    invIds.push((await db.insertInto('invoices').values({
      number: `INV-RM-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, kind: 'BALANCE', currency: 'BWP',
      reservation_id: id, subtotal_amount: paid, tax_rate_bps: 0, tax_amount: 0, total_amount: paid, status: 'PAID',
      issued_by: userId, created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow()).id);
  }
  return id;
}
const isDeleted = async (id: string) =>
  (await db.selectFrom('reservations').select('deleted_at').where('id', '=', id).executeTakeFirstOrThrow()).deleted_at !== null;

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'RM', email: `rm-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `RM guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `RM_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `RMB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'RM', code: `RM-${uniq}`.slice(0, 20), building_id: bldId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  if (invIds.length) await db.deleteFrom('invoices').where('id', 'in', invIds).execute();
  await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('removing a cancelled booking', () => {
  it('is refused while the booking still holds the guest’s money, and says how much', async () => {
    const id = await cancelled('2033-03-01', '2033-03-03', 50_000);
    await expect(service().removeReservation(id, meta(), propId)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service().removeReservation(id, meta(), propId)).rejects.toThrow(/still holds P500\.00/);
    expect(await isDeleted(id)).toBe(false);
  });

  it('goes ahead when no money is held', async () => {
    const id = await cancelled('2033-04-01', '2033-04-03', 0);
    await service().removeReservation(id, meta(), propId);
    expect(await isDeleted(id)).toBe(true);
  });
});
