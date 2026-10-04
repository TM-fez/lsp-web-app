/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Re-test round 3) A unit's status follows its open repairs: only a HIGH / CRITICAL job
 * takes it out of use (a LOW "dripping tap" used to block it for every date), finishing
 * one job keeps it blocked while another serious one is open, and a guest's OCCUPIED
 * room is never flipped by a repair.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { MaintenanceRepository } from '../../../src/modules/maintenance/maintenance.repository.js';

const repo = new MaintenanceRepository(db);
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, propId: string, bldId: string, roomId: string;
const orders: string[] = [];
const meta = () => ({ userId });

const status = async () => (await db.selectFrom('rooms').select('status').where('id', '=', roomId).executeTakeFirstOrThrow()).status;
async function order(priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') {
  const id = (await db.insertInto('maintenance_work_orders').values({
    room_id: roomId, title: `MS ${priority}`, priority, status: 'OPEN', reported_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  orders.push(id);
  return id;
}
const close = (id: string) => db.updateTable('maintenance_work_orders').set({ status: 'COMPLETED' } as never).where('id', '=', id).execute();

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'MS', email: `ms-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `MS_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `MSB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'MS', code: `MS-${uniq}`, building_id: bldId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await db.deleteFrom('maintenance_work_orders').where('id', 'in', orders).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('unit status follows its open repairs', () => {
  it('a LOW or MEDIUM job leaves the unit bookable', async () => {
    await order('LOW');
    await order('MEDIUM');
    await repo.syncRoomForMaintenance(roomId, meta());
    expect(await status()).toBe('AVAILABLE');
  });

  it('a HIGH job takes it out of use; it stays out while another serious job is open', async () => {
    const high = await order('HIGH');
    const critical = await order('CRITICAL');
    await repo.syncRoomForMaintenance(roomId, meta());
    expect(await status()).toBe('MAINTENANCE');
    await close(high);
    await repo.syncRoomForMaintenance(roomId, meta());
    expect(await status()).toBe('MAINTENANCE');
    await close(critical);
    await repo.syncRoomForMaintenance(roomId, meta());
    expect(await status()).toBe('AVAILABLE');
  });

  it('never flips a room with a guest in it', async () => {
    await db.updateTable('rooms').set({ status: 'OCCUPIED' }).where('id', '=', roomId).execute();
    await order('CRITICAL');
    await repo.syncRoomForMaintenance(roomId, meta());
    expect(await status()).toBe('OCCUPIED');
  });
});
