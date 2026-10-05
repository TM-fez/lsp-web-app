/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R7 N7-4) "Out of service" and "Maintenance" on a unit with future bookings or live holds
 * were accepted in silence: the unit went off sale and the guests stayed booked into it.
 * Like a serious repair over booked nights (R6), it is now a QUESTION — 409 "Unit Has
 * Bookings" — answered with `confirm_overlap`. Bookings are never moved automatically;
 * bare holds on the unit are released. A unit with nothing ahead closes as before.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { RoomsService } from '../../../src/modules/rooms/rooms.service.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, guestId: string, propId: string, bldId: string, bookedRoom: string, heldRoom: string, emptyRoom: string, planId: string;
const resIds: string[] = [], quoteIds: string[] = [], holdIds: string[] = [];
const service = () => new RoomsService(new RoomsRepository(db));
const meta = () => ({ userId });
const room = async (code: string) =>
  (await db.insertInto('rooms').values({ name: code, code: `${code}-${uniq}`.slice(0, 20), type: 'CONFERENCE', building_id: bldId, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
const status = async (id: string) => (await db.selectFrom('rooms').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'RC', email: `rc-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `RC guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `RC_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `RCB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bookedRoom = await room('RCA');
  heldRoom = await room('RCB');
  emptyRoom = await room('RCC');
  resIds.push((await db.insertInto('reservations').values({
    contact_id: guestId, room_id: bookedRoom, check_in_date: new Date('2034-10-09'), check_out_date: new Date('2034-10-12'),
    status: 'CONFIRMED', source: 'DIRECT', created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id);
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'CONFERENCE', name: `RC plan ${uniq}`, nightly_rate: 100_000, weekly_rate: 600_000, monthly_rate: 2_400_000,
    max_guests: 2, deposit_pct: 50, tax_rate_bps: 0, active: false, created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  const q = (await db.insertInto('quotes').values({
    rate_plan_id: planId, unit_type: 'CONFERENCE', check_in_date: new Date('2034-11-03'), check_out_date: new Date('2034-11-06'), guests: 1, nights: 3,
    base_amount: 300_000, tax_rate_bps: 0, tax_amount: 0, deposit_amount: 150_000, total_amount: 300_000,
    created_by: userId, expires_at: new Date(Date.now() + 3_600_000),
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  quoteIds.push(q);
  holdIds.push((await db.insertInto('holds').values({
    quote_id: q, room_id: heldRoom, status: 'HELD', held_until: new Date(Date.now() + 1_800_000), created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id);
});

afterAll(async () => {
  await db.deleteFrom('holds').where('id', 'in', holdIds).execute();
  await db.deleteFrom('quotes').where('id', 'in', quoteIds).execute();
  await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('id', 'in', [bookedRoom, heldRoom, emptyRoom]).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('closing a unit that still has bookings', () => {
  it('asks before taking a booked unit out of service, and leaves it open meanwhile', async () => {
    await expect(service().setOutOfService(bookedRoom, meta())).rejects.toMatchObject({ statusCode: 409, error: 'Unit Has Bookings' });
    expect(await status(bookedRoom)).toBe('AVAILABLE');
  });

  it('asks before putting a held unit into maintenance', async () => {
    await expect(service().setMaintenance(heldRoom, meta())).rejects.toMatchObject({ statusCode: 409, error: 'Unit Has Bookings' });
    expect((await db.selectFrom('holds').select('status').where('id', '=', holdIds[0]!).executeTakeFirstOrThrow()).status).toBe('HELD');
  });

  it('closes it when confirmed — the booking stays, the bare hold is released', async () => {
    await service().setMaintenance(heldRoom, meta(), { confirm_overlap: true });
    expect(await status(heldRoom)).toBe('MAINTENANCE');
    expect((await db.selectFrom('holds').select('status').where('id', '=', holdIds[0]!).executeTakeFirstOrThrow()).status).toBe('RELEASED');

    await service().setOutOfService(bookedRoom, meta(), { confirm_overlap: true });
    expect(await status(bookedRoom)).toBe('OUT_OF_SERVICE');
    expect((await db.selectFrom('reservations').select(['status', 'room_id']).where('id', '=', resIds[0]!).executeTakeFirstOrThrow()))
      .toEqual({ status: 'CONFIRMED', room_id: bookedRoom });
  });

  it('closes a unit with nothing ahead without asking', async () => {
    await service().setOutOfService(emptyRoom, meta());
    expect(await status(emptyRoom)).toBe('OUT_OF_SERVICE');
  });
});
