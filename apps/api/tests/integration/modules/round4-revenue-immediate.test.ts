/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 4, N-11) A booking taken today had no revenue-ledger rows until the next daily
 * sweep, so the accrual P&L under-reported "today". Now every successful write on a
 * booking route puts that booking's nights on the ledger before the reply goes out.
 *
 * The routes below are tiny stand-ins that change a booking the way the real ones do
 * (a status/folio write); the middleware under test is the real one.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { recogniseRevenueAfterWrite } from '../../../src/modules/revenue/revenue.middleware.js';
import { RevenueService } from '../../../src/modules/revenue/revenue.service.js';
import { errorHandler } from '../../../src/core/errors/errorHandler.middleware.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let userId: string, guestId: string, roomId: string, propertyId: string;
const created: string[] = [];

const app = express();
app.use(express.json());
app.use('/reservations', recogniseRevenueAfterWrite(db));
app.post('/reservations', async (req, res) => {
  const r = await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, source: 'DIRECT', created_by: userId, updated_by: userId,
    check_in_date: new Date(req.body.in), check_out_date: new Date(req.body.out),
    status: req.body.status, folio_total_amount: req.body.folio ?? null, folio_currency: 'BWP',
  } as never).returning('id').executeTakeFirstOrThrow();
  created.push(r.id);
  res.status(201).json({ id: r.id });
});
app.post('/reservations/:id/cancel', async (req, res) => {
  await db.updateTable('reservations').set({ status: 'CANCELLED' }).where('id', '=', req.params.id).execute();
  res.json({ ok: true });
});
app.post('/reservations/:id/fail', (_req, res) => res.status(409).json({ message: 'nope' }));
app.get('/reservations/:id/peek', (req, res) => res.json({ id: req.params.id }));
app.use(errorHandler);

const live = (id: string) =>
  db.selectFrom('revenue_recognition').select(['stay_date', 'amount']).where('reservation_id', '=', id).where('superseded_at', 'is', null).orderBy('stay_date').execute();

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'admin').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'Rev admin', email: `rev-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `Rev guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  propertyId = (await db.insertInto('properties').values({ name: `REV_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  const b = (await db.insertInto('buildings').values({ property_id: propertyId, name: `REV_B_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'Rev room', code: `REV-${uniq}`.slice(0, 20), type: 'CONFERENCE', capacity: 2, building_id: b, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await sql`DELETE FROM revenue_recognition WHERE reservation_id = ANY(${created}::uuid[])`.execute(db);
  await db.deleteFrom('reservations').where('id', 'in', created.length ? created : ['00000000-0000-0000-0000-000000000000']).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('property_id', '=', propertyId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('revenue ledger after a booking write', () => {
  it('has the nights of a confirmed, priced booking before the reply is read', async () => {
    const res = await request(app).post('/reservations').send({ in: '2035-03-01', out: '2035-03-04', status: 'CONFIRMED', folio: 300_000 });

    expect(res.status).toBe(201);
    const nights = await live(res.body.id);
    expect(nights.map((n) => Number(n.amount))).toEqual([100_000, 100_000, 100_000]);
  });

  it('leaves a PENDING booking off the ledger (it earns nothing yet)', async () => {
    const res = await request(app).post('/reservations').send({ in: '2035-04-01', out: '2035-04-03', status: 'PENDING', folio: 200_000 });

    expect(await live(res.body.id)).toEqual([]);
  });

  it('withdraws the nights when the booking is cancelled', async () => {
    const made = await request(app).post('/reservations').send({ in: '2035-05-01', out: '2035-05-03', status: 'CONFIRMED', folio: 200_000 });
    expect(await live(made.body.id)).toHaveLength(2);

    await request(app).post(`/reservations/${made.body.id}/cancel`).send({});

    expect(await live(made.body.id)).toEqual([]);
  });

  it('is idempotent: reconciling again changes nothing', async () => {
    const made = await request(app).post('/reservations').send({ in: '2035-06-01', out: '2035-06-03', status: 'CONFIRMED', folio: 200_000 });
    const before = await db.selectFrom('revenue_recognition').select(['id', 'version']).where('reservation_id', '=', made.body.id).execute();

    const again = await new RevenueService(new (await import('../../../src/modules/revenue/revenue.repository.js')).RevenueRepository(db)).reconcileFor([made.body.id]);

    expect(again.reservations_changed).toBe(0);
    const after = await db.selectFrom('revenue_recognition').select(['id', 'version']).where('reservation_id', '=', made.body.id).execute();
    expect(after).toEqual(before);
  });

  it('does nothing for reads or for a refused write', async () => {
    const spy = vi.spyOn(RevenueService.prototype, 'reconcileFor');

    await request(app).get('/reservations/00000000-0000-4000-a000-000000000001/peek');
    await request(app).post('/reservations/00000000-0000-4000-a000-000000000001/fail').send({});

    expect(spy).not.toHaveBeenCalled();
  });

  it('never breaks the booking if recognising fails — the reply still goes out', async () => {
    vi.spyOn(RevenueService.prototype, 'reconcileFor').mockRejectedValue(new Error('ledger down'));

    const res = await request(app).post('/reservations').send({ in: '2035-07-01', out: '2035-07-03', status: 'CONFIRMED', folio: 200_000 });

    expect(res.status).toBe(201);
    expect(await live(res.body.id)).toEqual([]); // the sweep will pick it up
  });
});

describe('a write only touches the bookings it names', () => {
  it('does not retire the ledger rows of another booking that was cancelled behind the scenes', async () => {
    const mk = (day: string) => request(app).post('/reservations').send({ in: `2035-06-${day}`, out: `2035-06-0${Number(day) + 1}`, status: 'CONFIRMED', folio: 100_000 });
    const [a, b] = [(await mk('01')).body.id as string, (await mk('03')).body.id as string];
    // B is cancelled by something that did not go through the middleware (a script, a manual fix).
    await db.updateTable('reservations').set({ status: 'CANCELLED' }).where('id', '=', b).execute();

    await request(app).post(`/reservations/${a}/cancel`).send({});

    expect(await live(a)).toEqual([]);          // the one this request named is settled…
    expect((await live(b)).length).toBe(1);     // …the other is left for the sweep, not this request
  });
});
