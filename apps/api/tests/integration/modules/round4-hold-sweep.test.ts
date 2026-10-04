/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, NEW-13) POST /holds/sweep/release-expired released EVERY expired hold in the
 * house for any reception/operations user, with no record of who did it. A CBD user's sweep
 * now touches only CBD holds, and writes one audit row per released hold. The scheduled
 * sweep (no user) still releases everything.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { sql } from 'kysely';
import { createHoldsRouter } from '../../../src/modules/holds/holds.routes.js';
import { HoldsRepository } from '../../../src/modules/holds/holds.repository.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';

const mockState = vi.hoisted(() => ({ user: null as any }));
vi.mock('jsonwebtoken', () => ({
  default: {
    verify: () => {
      if (!mockState.user) throw new Error('jwt malformed');
      return mockState.user;
    },
  },
}));

const app = express();
app.use(express.json());
app.use('/holds', createHoldsRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let user: string, propCbd: string, propVillage: string, planId: string;
const quoteIds: string[] = [];
let cbdHold: string, villageHold: string, orphanHold: string;
const rooms: string[] = [];
const holdIds: string[] = [];

const asCbd = () => { mockState.user = { sub: user, role: 'reception', permissions: ['holds.read', 'holds.update'] }; };
const sweep = () => request(app).post('/holds/sweep/release-expired').set('Authorization', 'Bearer t');
const statusOf = async (id: string) => (await db.selectFrom('holds').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'reception').executeTakeFirstOrThrow()).id;
  user = (await db.insertInto('users').values({ role_id: role, name: 'Sweep user', email: `sw-${uniq}@t.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
  const prop = async (t: string) => {
    const p = (await db.insertInto('properties').values({ name: `SW_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const b = (await db.insertInto('buildings').values({ property_id: p, name: `SWB_${t}_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
    const r = (await db.insertInto('rooms').values({ name: `SW ${t}`, code: `SW-${t}-${uniq}`, building_id: b, created_by: user, updated_by: user })
      .returning('id').executeTakeFirstOrThrow()).id;
    rooms.push(r);
    return { p, b, r };
  };
  const cbd = await prop('CBD');
  const vil = await prop('VIL');
  propCbd = cbd.p;
  propVillage = vil.p;
  await db.insertInto('user_properties').values({ user_id: user, property_id: propCbd }).execute();
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'CUSTOM', name: `SW plan ${uniq}`, nightly_rate: 1000, weekly_rate: 6000, monthly_rate: 24000, active: false,
    created_by: user, updated_by: user,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  // One active hold per quote (holds_active_quote_unique), so each hold gets its own quote.
  const quote = async () => {
    const id = (await db.insertInto('quotes').values({
      rate_plan_id: planId, unit_type: 'CUSTOM', check_in_date: new Date('2033-08-01'), check_out_date: new Date('2033-08-02'),
      nights: 1, base_amount: 1000, tax_rate_bps: 0, tax_amount: 0, deposit_amount: 500, total_amount: 1000,
      expires_at: sql`now() + interval '1 day'`, created_by: user,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
    quoteIds.push(id);
    return id;
  };
  const hold = async (room_id: string | null) => {
    const id = (await db.insertInto('holds').values({
      quote_id: await quote(), room_id, status: 'HELD', held_until: sql`now() - interval '1 hour'`, created_by: user, updated_by: user,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
    holdIds.push(id);
    return id;
  };
  cbdHold = await hold(cbd.r);
  villageHold = await hold(vil.r);
  orphanHold = await hold(null);
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('entity_id', 'in', holdIds).execute();
  await db.deleteFrom('holds').where('id', 'in', holdIds).execute();
  await db.deleteFrom('quotes').where('id', 'in', quoteIds).execute();
  await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
  await db.deleteFrom('rooms').where('id', 'in', rooms).execute();
  await db.deleteFrom('buildings').where('property_id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', user).execute();
  await db.deleteFrom('user_properties').where('user_id', '=', user).execute();
  await db.deleteFrom('properties').where('id', 'in', [propCbd, propVillage]).execute();
  await db.deleteFrom('users').where('id', '=', user).execute();
});

describe('POST /holds/sweep/release-expired', () => {
  it('a CBD user releases only CBD holds — Village and unattributed holds stay held', async () => {
    asCbd();
    const res = await sweep();
    expect(res.status).toBe(200);
    expect(await statusOf(cbdHold)).toBe('EXPIRED');
    expect(await statusOf(villageHold)).toBe('HELD');
    expect(await statusOf(orphanHold)).toBe('HELD');
  });

  it('writes an audit row for the hold it released, naming who did it', async () => {
    const rows = await db.selectFrom('audit_logs').select(['user_id', 'action', 'entity'])
      .where('entity_id', '=', cbdHold).execute();
    expect(rows).toEqual([{ user_id: user, action: 'UPDATE', entity: 'holds' }]);
    expect(await db.selectFrom('audit_logs').select('id').where('entity_id', 'in', [villageHold, orphanHold]).execute()).toHaveLength(0);
  });

  // The all-property (null) and scheduled (no scope) paths release holds house-wide, which
  // would also release other test files' expired holds in this shared database, so they are
  // not exercised here: the scheduled path is covered by the scheduler unit tests, and this
  // checks the explicit-list path a second property's user would take.
  it('a user of the other property, with a different list, releases that property’s hold with its own audit row', async () => {
    const n = await new HoldsRepository(db).releaseExpired({ propertyIds: [propVillage], meta: { userId: user } });
    expect(n).toBe(1);
    expect(await statusOf(villageHold)).toBe('EXPIRED');
    expect(await statusOf(orphanHold)).toBe('HELD');
    expect(await db.selectFrom('audit_logs').select('id').where('entity_id', '=', villageHold).execute()).toHaveLength(1);
  });

  it('a user with no properties releases nothing', async () => {
    expect(await new HoldsRepository(db).releaseExpired({ propertyIds: [], meta: { userId: user } })).toBe(0);
    expect(await statusOf(orphanHold)).toBe('HELD');
  });
});
