/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (R6, related to NEW-8) A CRITICAL repair for 20–23 Oct was logged on a unit with a
 * CONFIRMED booking 9–30 Oct, with no warning; a HIGH/CRITICAL repair could also be logged
 * over a live bare hold, which stayed HELD. A serious repair that takes the unit out of use
 * on nights already booked or held is now a QUESTION (409 "Repair Overlap") — it saves only
 * with `confirm_overlap`, and then any bare hold on those nights is released.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { MaintenanceService } from '../../../src/modules/maintenance/maintenance.service.js';
import { MaintenanceRepository } from '../../../src/modules/maintenance/maintenance.repository.js';
import { FilesRepository } from '../../../src/modules/files/files.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, guestId: string, propId: string, bldId: string, roomId: string, planId: string;
const resIds: string[] = [], quoteIds: string[] = [], holdIds: string[] = [];
const notifications = { notify: async () => undefined } as never;
const service = () => new MaintenanceService(new MaintenanceRepository(db), new FilesRepository(db), notifications);
const meta = () => ({ userId });
const order = (over: Record<string, unknown>) => ({ room_id: roomId, title: 'Geyser', priority: 'CRITICAL', ...over }) as never;

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'RO', email: `ro-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `RO guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `RO_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `ROB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'RO', code: `RO-${uniq}`.slice(0, 20), type: 'CONFERENCE', building_id: bldId, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'CONFERENCE', name: `RO plan ${uniq}`, nightly_rate: 100_000, weekly_rate: 600_000, monthly_rate: 2_400_000,
    max_guests: 2, deposit_pct: 50, tax_rate_bps: 0, active: false, created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  // A CONFIRMED booking 9–30 Oct, as in the report.
  resIds.push((await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, check_in_date: new Date('2034-10-09'), check_out_date: new Date('2034-10-30'),
    status: 'CONFIRMED', source: 'DIRECT', created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id);
  // A live bare hold 3–6 Nov.
  const q = (await db.insertInto('quotes').values({
    rate_plan_id: planId, unit_type: 'CONFERENCE', check_in_date: new Date('2034-11-03'), check_out_date: new Date('2034-11-06'), guests: 1, nights: 3,
    base_amount: 300_000, tax_rate_bps: 0, tax_amount: 0, deposit_amount: 150_000, total_amount: 300_000,
    created_by: userId, expires_at: new Date(Date.now() + 3_600_000),
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  quoteIds.push(q);
  holdIds.push((await db.insertInto('holds').values({
    quote_id: q, room_id: roomId, status: 'HELD', held_until: new Date(Date.now() + 1_800_000), created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id);
});

afterAll(async () => {
  await db.deleteFrom('maintenance_work_orders').where('room_id', '=', roomId).execute();
  await db.deleteFrom('holds').where('id', 'in', holdIds).execute();
  await db.deleteFrom('quotes').where('id', 'in', quoteIds).execute();
  await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('a serious repair over booked or held nights', () => {
  it('asks first when the repair dates fall inside a booking', async () => {
    const err = await service().openWorkOrder(order({ blocks_from: '2034-10-20', blocks_to: '2034-10-23' }), meta(), propId).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.error).toBe('Repair Overlap');
    expect(err.message).toMatch(/1 booking/);
  });

  it('asks first over a live bare hold — and releases the hold when told to go ahead', async () => {
    const err = await service().openWorkOrder(order({ blocks_from: '2034-11-04', blocks_to: '2034-11-05' }), meta(), propId).catch((e) => e);
    expect(err.error).toBe('Repair Overlap');
    expect(err.message).toMatch(/1 hold/);

    await service().openWorkOrder(order({ blocks_from: '2034-11-04', blocks_to: '2034-11-05', confirm_overlap: true }), meta(), propId);
    const hold = await db.selectFrom('holds').select(['status', 'release_reason']).where('id', '=', holdIds[0]!).executeTakeFirstOrThrow();
    expect(hold).toEqual({ status: 'RELEASED', release_reason: 'repair' });
  });

  it('a LOW job, or dates clear of every booking and hold, saves without asking', async () => {
    await service().openWorkOrder(order({ priority: 'LOW', blocks_from: '2034-10-20', blocks_to: '2034-10-23' }), meta(), propId);
    await service().openWorkOrder(order({ blocks_from: '2034-12-01', blocks_to: '2034-12-03' }), meta(), propId);
  });
});
