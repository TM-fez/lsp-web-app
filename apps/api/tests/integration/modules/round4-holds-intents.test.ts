/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, R3-5 / R3-L4)
 *  - A booking-less hold reserves its unit alone. It used to say "a live hold already exists
 *    for this quote" when the real reason was another quote holding the UNIT, could be placed
 *    on nights somebody had booked, and did not stop a booking on the same nights.
 *  - When a hold expires its payment attempt must close too, and a SUCCESS against a hold
 *    that has run out of time must be refused whether or not the sweep has reached it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createReservationsRouter } from '../../../src/modules/reservations/reservations.routes.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';
import { db } from '../../../src/config/db.js';
import { HoldsService } from '../../../src/modules/holds/holds.service.js';
import { HoldsRepository } from '../../../src/modules/holds/holds.repository.js';
import { QuotesService } from '../../../src/modules/quotes/quotes.service.js';
import { QuotesRepository } from '../../../src/modules/quotes/quotes.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';
import { PaymentsService } from '../../../src/modules/payments/payments.service.js';
import { PaymentsRepository } from '../../../src/modules/payments/payments.repository.js';
import { expireIntentsOfDeadHolds } from '../../../src/modules/payments/payments.expiry.js';

const mockState = vi.hoisted(() => ({ user: null as any }));
vi.mock('jsonwebtoken', () => ({
  default: { verify: () => { if (!mockState.user) throw new Error('jwt malformed'); return mockState.user; } },
}));

const app = express();
app.use(express.json());
app.use('/reservations', createReservationsRouter());
app.use(errorHandler);

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, propId: string, bldId: string, roomId: string, guestId: string, planId: string;
const quoteIds: string[] = [], holdIds: string[] = [], reservationIds: string[] = [], intentIds: string[] = [];
const meta = () => ({ userId });

const pricing = new PricingService(new PricingRepository(db));
const quotes = new QuotesService(new QuotesRepository(db), pricing);
const holds = new HoldsService(new HoldsRepository(db), quotes);
const payments = new PaymentsService(new PaymentsRepository(db), new HoldsRepository(db), quotes);

const d = (iso: string) => new Date(iso);
async function quote(ci: string, co: string) {
  const id = (await db.insertInto('quotes').values({
    rate_plan_id: planId, unit_type: 'CONFERENCE', check_in_date: d(ci), check_out_date: d(co), guests: 1, nights: 2,
    base_amount: 200_000, tax_rate_bps: 0, tax_amount: 0, deposit_amount: 100_000, total_amount: 200_000,
    created_by: userId, expires_at: new Date(Date.now() + 3_600_000),
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  quoteIds.push(id);
  return id;
}
async function booking(ci: string, co: string, status: 'PENDING' | 'CONFIRMED' = 'PENDING') {
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, check_in_date: d(ci), check_out_date: d(co), status, source: 'DIRECT',
    created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  reservationIds.push(id);
  return id;
}
const closeHolds = () => db.updateTable('holds').set({ status: 'RELEASED' }).where('id', 'in', holdIds.length ? holdIds : ['00000000-0000-0000-0000-000000000000']).execute();
const post = (body: object) => request(app).post('/reservations').set('Authorization', 'Bearer t').set('X-Property-Id', propId).send(body);

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'HI', email: `hi-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `HI_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `HIB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'HI', code: `HI-${uniq}`.slice(0, 20), type: 'CONFERENCE', capacity: 2, building_id: bldId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `HI guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'CONFERENCE', name: `HI plan ${uniq}`, nightly_rate: 100_000, weekly_rate: 600_000, monthly_rate: 2_400_000,
    max_guests: 2, deposit_pct: 50, tax_rate_bps: 0, active: false, created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  mockState.user = { sub: userId, role: 'admin', permissions: ['reservations.create', 'reservations.read'] };
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  if (intentIds.length) {
    await db.deleteFrom('audit_logs').where('entity_id', 'in', intentIds).execute();
    await db.deleteFrom('payment_attempts').where('payment_intent_id', 'in', intentIds).execute();
    await db.deleteFrom('payment_intents').where('id', 'in', intentIds).execute();
  }
  if (holdIds.length) await db.deleteFrom('holds').where('id', 'in', holdIds).execute();
  if (reservationIds.length) await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
  await db.deleteFrom('quotes').where('id', 'in', quoteIds).execute();
  await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('a hold on a unit with no booking behind it', () => {
  // (R5, migration 084) A bare hold blocks its own nights only — not the whole unit.
  it('lets two quotes hold the same unit on different dates', async () => {
    const first = await holds.createHold({ quote_id: await quote('2036-01-10', '2036-01-12'), room_id: roomId } as never, meta());
    holdIds.push(first.id);
    const second = await holds.createHold({ quote_id: await quote('2036-02-10', '2036-02-12'), room_id: roomId } as never, meta());
    holdIds.push(second.id);
    // Half-open, like bookings: one quote's check-out day is the next one's check-in.
    const turnover = await holds.createHold({ quote_id: await quote('2036-01-12', '2036-01-14'), room_id: roomId } as never, meta());
    holdIds.push(turnover.id);
    expect(second.check_in_date).not.toBeNull();
    await closeHolds();
  });

  it('says the UNIT is held on those dates when another quote overlaps, not "this quote"', async () => {
    const first = await holds.createHold({ quote_id: await quote('2036-03-10', '2036-03-14'), room_id: roomId } as never, meta());
    holdIds.push(first.id);

    const second = holds.createHold({ quote_id: await quote('2036-03-12', '2036-03-16'), room_id: roomId } as never, meta());

    await expect(second).rejects.toThrow(/already being held for another quote on some of those dates/i);
    await closeHolds();
  });

  it('blocks a booking on overlapping nights, but not on other nights', async () => {
    const h = await holds.createHold({ quote_id: await quote('2036-05-10', '2036-05-14'), room_id: roomId } as never, meta());
    holdIds.push(h.id);
    const body = (ci: string, co: string) => ({ contact_id: guestId, room_id: roomId, check_in_date: ci, check_out_date: co });

    const clash = await post(body('2036-05-12', '2036-05-16'));
    const clear = await post(body('2036-06-12', '2036-06-14'));

    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/being held for another guest/i);
    expect(clear.status).toBe(201);
    reservationIds.push(clear.body.id);
    await closeHolds();
  });
});

describe('payment attempts and an expired hold', () => {
  async function pendingIntentOn(holdStatus: 'HELD' | 'EXPIRED', heldUntil: Date) {
    const reservationId = await booking(`2037-0${intentIds.length + 1}-10`, `2037-0${intentIds.length + 1}-12`);
    const q = await quote('2037-01-10', '2037-01-12');
    const hold = (await db.insertInto('holds').values({
      quote_id: q, room_id: roomId, reservation_id: reservationId, status: holdStatus, held_until: heldUntil,
      created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
    holdIds.push(hold);
    const intent = (await db.insertInto('payment_intents').values({
      hold_id: hold, quote_id: q, purpose: 'DEPOSIT', amount: 100_000, currency: 'BWP', method: 'CASH', status: 'PENDING',
      created_by: userId, updated_by: userId,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
    intentIds.push(intent);
    return { intent, hold, reservationId };
  }
  const statusOf = async (id: string) => (await db.selectFrom('payment_intents').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;

  it('closes the attempt when its hold has been swept', async () => {
    const { intent } = await pendingIntentOn('EXPIRED', new Date(Date.now() - 60_000));

    await expireIntentsOfDeadHolds(db);

    expect(await statusOf(intent)).toBe('EXPIRED');
    const audit = await db.selectFrom('audit_logs').select('diff').where('entity_id', '=', intent).execute();
    expect(audit).toHaveLength(1);
  });

  it('leaves the attempt on a still-live hold alone', async () => {
    const { intent } = await pendingIntentOn('HELD', new Date(Date.now() + 600_000));

    await expireIntentsOfDeadHolds(db);

    expect(await statusOf(intent)).toBe('PENDING');
  });

  it('refuses a SUCCESS on a hold that ran out of time, even before the sweep reached it', async () => {
    const { intent, reservationId } = await pendingIntentOn('HELD', new Date(Date.now() - 60_000));

    await expect(payments.attempt(intent, { outcome: 'SUCCESS' } as never, meta())).rejects.toThrow(/hold has expired/i);

    expect(await statusOf(intent)).toBe('PENDING');
    const paid = await db.selectFrom('invoices').select('id').where('reservation_id', '=', reservationId).execute();
    expect(paid).toHaveLength(0);
  });

  it('gives the same refusal once the sweep HAS reached the hold', async () => {
    const { intent } = await pendingIntentOn('EXPIRED', new Date(Date.now() - 60_000));

    await expect(payments.attempt(intent, { outcome: 'SUCCESS' } as never, meta())).rejects.toThrow(/expired|cannot proceed/i);
  });
});
