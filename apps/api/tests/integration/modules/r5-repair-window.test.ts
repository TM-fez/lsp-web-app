/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R5 owner decision, migration 085) A HIGH / CRITICAL repair with dates blocks only those
 * nights — not every date, as an open-ended one still does. Search (availability), the
 * booking check (checkAvailability) and the unit's status must all agree, the D01 rule:
 * what search calls free is bookable, and vice versa.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { MaintenanceRepository } from '../../../src/modules/maintenance/maintenance.repository.js';
import { AvailabilityRepository } from '../../../src/modules/availability/availability.repository.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { UpdateWorkOrderSchema, CreateWorkOrderSchema } from '../../../src/modules/maintenance/maintenance.types.js';

const maintenance = new MaintenanceRepository(db);
const availability = new AvailabilityRepository(db);
const reservations = new ReservationsRepository(db);
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, propId: string, bldId: string, roomId: string;
const orders: string[] = [];
const meta = () => ({ userId });

const status = async () => (await db.selectFrom('rooms').select('status').where('id', '=', roomId).executeTakeFirstOrThrow()).status;
async function order(priority: 'HIGH' | 'CRITICAL' | 'LOW', window?: [string, string]) {
  const id = (await db.insertInto('maintenance_work_orders').values({
    room_id: roomId, title: `RW ${priority}`, priority, status: 'OPEN', reported_by: userId,
    blocks_from: window?.[0] ?? null, blocks_to: window?.[1] ?? null,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  orders.push(id);
  return id;
}
const close = (id: string) => db.updateTable('maintenance_work_orders').set({ status: 'COMPLETED' } as never).where('id', '=', id).execute();

/** Search's answer and the booking check's answer for one range — they must match. */
async function bothViews(checkIn: string, checkOut: string) {
  const [signal] = (await availability.findRoomSignals(
    { checkIn: new Date(checkIn), checkOut: new Date(checkOut) },
    { minCapacity: 0, propertyId: propId },
    { page: 1, limit: 10 },
    true
  )).filter((s) => s.id === roomId);
  const searchFree = Boolean(signal);
  const bookable = await reservations.checkAvailability(roomId, new Date(checkIn), new Date(checkOut));
  return { searchFree, bookable };
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'RW', email: `rw-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `RW_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `RWB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'RW', code: `RW-${uniq}`, building_id: bldId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await db.deleteFrom('maintenance_work_orders').where('id', 'in', orders).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('a dated serious repair blocks only its own nights', () => {
  it('leaves the unit AVAILABLE and blocks exactly [from, to) in search and booking alike', async () => {
    const id = await order('CRITICAL', ['2037-03-10', '2037-03-12']);
    await maintenance.syncRoomForMaintenance(roomId, meta());
    expect(await status()).toBe('AVAILABLE');

    expect(await bothViews('2037-03-11', '2037-03-13')).toEqual({ searchFree: false, bookable: false });
    expect(await bothViews('2037-03-08', '2037-03-10')).toEqual({ searchFree: true, bookable: true });
    // Half-open: the "back in use" day is bookable.
    expect(await bothViews('2037-03-12', '2037-03-14')).toEqual({ searchFree: true, bookable: true });

    const day = (d: string) => (async () => {
      const rows = await availability.getCalendar({ checkIn: new Date('2037-03-09'), checkOut: new Date('2037-03-13') }, { minCapacity: 0, propertyId: propId });
      return rows.find((r) => r.day === d)!;
    })();
    expect((await day('2037-03-10')).free_rooms).toBe(0);
    expect((await day('2037-03-12')).free_rooms).toBe(1);

    await close(id);
    expect(await bothViews('2037-03-11', '2037-03-13')).toEqual({ searchFree: true, bookable: true });
  });

  it('a LOW job with dates blocks nothing', async () => {
    const id = await order('LOW', ['2037-04-10', '2037-04-12']);
    expect(await bothViews('2037-04-10', '2037-04-11')).toEqual({ searchFree: true, bookable: true });
    await close(id);
  });

  it('an undated serious repair still blocks every date', async () => {
    const id = await order('HIGH');
    await maintenance.syncRoomForMaintenance(roomId, meta());
    expect(await status()).toBe('MAINTENANCE');
    expect(await bothViews('2037-09-01', '2037-09-03')).toEqual({ searchFree: false, bookable: false });
    await close(id);
    await maintenance.syncRoomForMaintenance(roomId, meta());
    expect(await status()).toBe('AVAILABLE');
  });
});

describe('repair window input', () => {
  const base = { room_id: '00000000-0000-0000-0000-000000000000', title: 'Geyser', priority: 'HIGH' };
  it('needs both dates, the second after the first', () => {
    expect(CreateWorkOrderSchema.safeParse({ ...base, blocks_from: '2037-03-10' }).success).toBe(false);
    expect(CreateWorkOrderSchema.safeParse({ ...base, blocks_from: '2037-03-10', blocks_to: '2037-03-10' }).success).toBe(false);
    expect(CreateWorkOrderSchema.safeParse({ ...base, blocks_from: '2037-03-10', blocks_to: '2037-03-11' }).success).toBe(true);
    expect(CreateWorkOrderSchema.safeParse(base).success).toBe(true);
  });
  it('lets an edit leave the window alone, or clear it', () => {
    expect(UpdateWorkOrderSchema.safeParse({ title: 'x' }).success).toBe(true);
    expect(UpdateWorkOrderSchema.safeParse({ blocks_from: null, blocks_to: null }).success).toBe(true);
    expect(UpdateWorkOrderSchema.safeParse({ blocks_to: '2037-03-11' }).success).toBe(false);
  });
});
