/**
 * Sprint 9 — Operations Cockpit END-TO-END (live DB).
 *
 * Drives the whole operating loop against a real Postgres:
 *   assign -> quote -> hold -> pay -> reservation CONFIRMED ->
 *   check-in -> check-out -> DIRTY -> clean -> inspect -> ready -> assignable.
 *
 * Requires DATABASE_URL pointing at a migrated + seeded database. Run with:
 *   DATABASE_URL=... npx vitest run --config vitest.e2e.config.ts
 */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { pool } from '../../src/config/db.js';

const stamp = Date.now();
// Offset from the PROPERTY day (Africa/Gaborone), matching the server's "today"
// check — so iso(0) is never seen as "in the past" when UTC trails Gaborone.
const iso = (offsetDays: number) => {
  const todayInGaborone = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone' }).format(new Date());
  const d = new Date(`${todayInGaborone}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

let token = '';
const bearer = () => `Bearer ${token}`;

// Multi-property scope: the active property the portal is working in, plus a
// building inside it to place the test unit. Sent as X-Property-Id on scoped routes.
let propertyId = '';
let buildingId = '';

let roomId = '';
let contactId = '';
let reservationId = '';
let quoteId = '';
let holdId = '';
let intentId = '';
let occupancyId = '';
let reservation2Id = '';
let ratePlanId = '';

/**
 * Undo everything this file created, so the suite can be run twice against one database.
 *
 * It could not be. Only one rate plan per unit type may be ACTIVE
 * (`rate_plans_active_unit_type_unique`), and this file creates a STANDARD one and left it
 * behind — so the second run got a 500 on "creates a STANDARD rate plan" and every later
 * step fell over with it. CI never saw it, because CI gets a fresh container each time; it
 * only ever cost whoever was running the suite locally, which is the person least able to
 * tell a real failure from a dirty database.
 *
 * Deleted in FK order, and only by id — the property and building are RESOLVED from the
 * seed rather than created here, so they are not ours to remove. Each statement is
 * independent: one failing must not strand the rest, or the next run is dirty again.
 */
afterAll(async () => {
  const run = async (label: string, sql: string, params: unknown[]) => {
    if (params.some((p) => !p)) return;
    try {
      await pool.query(sql, params);
    } catch (err) {
      // Surfaced, not swallowed: a teardown that fails silently is how this started.
      console.warn(`[e2e teardown] ${label} —`, (err as Error).message);
    }
  };

  // Almost everything this file creates hangs off the one test unit, so delete by
  // room_id rather than by the handful of ids the tests happened to capture — a test
  // that failed early leaves rows whose id was never assigned to a variable.
  await run('payment_attempts', `DELETE FROM payment_attempts WHERE payment_intent_id IN
    (SELECT pi.id FROM payment_intents pi JOIN holds h ON h.id = pi.hold_id WHERE h.room_id = $1)`, [roomId]);
  await run('payment_intents', `DELETE FROM payment_intents WHERE hold_id IN
    (SELECT id FROM holds WHERE room_id = $1)`, [roomId]);
  await run('housekeeping_tasks', 'DELETE FROM housekeeping_tasks WHERE room_id = $1', [roomId]);
  await run('occupancy', 'DELETE FROM occupancy WHERE room_id = $1', [roomId]);
  await run('holds', 'DELETE FROM holds WHERE room_id = $1', [roomId]);
  await run('reservations', 'DELETE FROM reservations WHERE room_id = $1', [roomId]);
  await run('rooms', 'DELETE FROM rooms WHERE id = $1', [roomId]);
  await run('contacts', 'DELETE FROM contacts WHERE id = $1', [contactId]);
  await run('quotes', 'DELETE FROM quotes WHERE rate_plan_id = $1', [ratePlanId]);
  // The one that actually blocked a re-run: only one rate plan per unit type may be
  // ACTIVE, so leaving this behind 500'd the next run's very first write.
  await run('rate_plans', 'DELETE FROM rate_plans WHERE id = $1', [ratePlanId]);

  await pool.end();
});

describe('Operations Cockpit — end to end', () => {
  it('logs in as the seeded admin', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@lsp.local',
      password: 'Admin@123!',
    });
    expect(res.status).toBe(200);
    token = res.body.accessToken;
    expect(token).toBeTruthy();
  });

  it('resolves an active property and a building to place the unit in', async () => {
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', bearer());
    expect(me.status).toBe(200);
    propertyId = me.body.properties[0].id;
    expect(propertyId).toBeTruthy();

    const props = await request(app).get('/api/v1/properties').set('Authorization', bearer());
    expect(props.status).toBe(200);
    const prop = props.body.find((p: { id: string }) => p.id === propertyId);
    buildingId = prop.buildings[0].id;
    expect(buildingId).toBeTruthy();
  });

  it('creates a STANDARD rate plan', async () => {
    const res = await request(app)
      .post('/api/v1/pricing')
      .set('Authorization', bearer())
      .send({
        unit_type: 'STANDARD',
        name: `E2E Standard ${stamp}`,
        nightly_rate: 50000,
        weekly_rate: 300000,
        monthly_rate: 1100000,
      });
    expect(res.status).toBe(201);
    ratePlanId = res.body.id;
  });

  it('creates an AVAILABLE + READY unit', async () => {
    const res = await request(app)
      .post('/api/v1/rooms')
      .set('Authorization', bearer())
      .send({ name: `E2E Unit ${stamp}`, code: `E2E-${stamp}`, type: 'STANDARD', capacity: 2, building_id: buildingId });
    expect(res.status).toBe(201);
    roomId = res.body.id;
    expect(res.body.status).toBe('AVAILABLE');
    expect(res.body.housekeeping_status).toBe('READY');
  });

  it('creates a guest', async () => {
    const res = await request(app)
      .post('/api/v1/contacts')
      .set('Authorization', bearer())
      .send({ type: 'individual', name: `E2E Guest ${stamp}`, phone: '+267 71 000 000' });
    expect(res.status).toBe(201);
    contactId = res.body.id;
  });

  it('creates a PENDING reservation, quote, hold and payment intent', async () => {
    const resv = await request(app)
      .post('/api/v1/reservations')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({
        contact_id: contactId,
        room_id: roomId,
        check_in_date: iso(0),
        check_out_date: iso(2),
        status: 'PENDING',
      });
    expect(resv.status).toBe(201);
    reservationId = resv.body.id;
    expect(resv.body.status).toBe('PENDING');

    const quote = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', bearer())
      .send({ unit_type: 'STANDARD', check_in: iso(0), check_out: iso(2), guests: 1 });
    expect(quote.status).toBe(201);
    quoteId = quote.body.id;
    expect(quote.body.deposit_amount).toBeGreaterThan(0);

    const hold = await request(app)
      .post('/api/v1/holds')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({ quote_id: quoteId, room_id: roomId, reservation_id: reservationId });
    expect(hold.status).toBe(201);
    holdId = hold.body.id;
    expect(hold.body.status).toBe('HELD');

    const intent = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({ hold_id: holdId, method: 'CASH', purpose: 'DEPOSIT' });
    expect(intent.status).toBe(201);
    intentId = intent.body.id;
  });

  it('closes the money loop: SUCCESS confirms intent, hold AND reservation', async () => {
    const attempt = await request(app)
      .post(`/api/v1/payments/${intentId}/attempt`)
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({ outcome: 'SUCCESS' });
    expect(attempt.status).toBe(200);
    expect(attempt.body.status).toBe('PAID');

    const hold = await request(app).get(`/api/v1/holds/${holdId}`).set('Authorization', bearer()).set('X-Property-Id', propertyId);
    expect(hold.body.status).toBe('CONFIRMED');

    const resv = await request(app)
      .get(`/api/v1/reservations/${reservationId}`)
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId);
    expect(resv.body.status).toBe('CONFIRMED'); // ← the gap Sprint 8 left, now closed
  });

  it('checks the guest in — unit becomes OCCUPIED', async () => {
    const res = await request(app)
      .post('/api/v1/checkins')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({ reservation_id: reservationId, guest_count: 1 });
    expect(res.status).toBe(201);
    occupancyId = res.body.id;

    const room = await request(app).get(`/api/v1/rooms/${roomId}`).set('Authorization', bearer()).set('X-Property-Id', propertyId);
    expect(room.body.status).toBe('OCCUPIED');
  });

  it('checks the guest out — unit goes AVAILABLE + DIRTY and a turn is queued', async () => {
    const res = await request(app)
      .post(`/api/v1/checkins/${occupancyId}/checkout`)
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({});
    expect(res.status).toBe(200);

    const room = await request(app).get(`/api/v1/rooms/${roomId}`).set('Authorization', bearer()).set('X-Property-Id', propertyId);
    expect(room.body.status).toBe('AVAILABLE');
    expect(room.body.housekeeping_status).toBe('DIRTY');

    const queue = await request(app).get('/api/v1/housekeeping/queue').set('Authorization', bearer()).set('X-Property-Id', propertyId);
    expect(queue.body.data.some((t: { room_id: string }) => t.room_id === roomId)).toBe(true);
  });

  it('refuses to check a guest into a not-yet-cleaned unit', async () => {
    // A reservation reaches CONFIRMED only through the money loop (settlePaid),
    // never by setting status directly — so confirm reservation #2 by paying.
    const resv = await request(app)
      .post('/api/v1/reservations')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({
        contact_id: contactId,
        room_id: roomId,
        check_in_date: iso(3),
        check_out_date: iso(5),
      });
    expect(resv.status).toBe(201);
    expect(resv.body.status).toBe('PENDING');
    reservation2Id = resv.body.id;

    const quote2 = await request(app)
      .post('/api/v1/quotes')
      .set('Authorization', bearer())
      .send({ unit_type: 'STANDARD', check_in: iso(3), check_out: iso(5), guests: 1 });
    const hold2 = await request(app)
      .post('/api/v1/holds')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({ quote_id: quote2.body.id, room_id: roomId, reservation_id: reservation2Id });
    const intent2 = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({ hold_id: hold2.body.id, method: 'CASH', purpose: 'DEPOSIT' });
    const paid2 = await request(app)
      .post(`/api/v1/payments/${intent2.body.id}/attempt`)
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({ outcome: 'SUCCESS' });
    expect(paid2.body.status).toBe('PAID');

    const confirmed2 = await request(app)
      .get(`/api/v1/reservations/${reservation2Id}`)
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId);
    expect(confirmed2.body.status).toBe('CONFIRMED');

    const blocked = await request(app)
      .post('/api/v1/checkins')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({ reservation_id: reservation2Id, guest_count: 1 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message ?? blocked.body.error).toMatch(/ready/i);
  });

  it('runs the turn start -> checklist -> inspect -> ready and reopens the unit', async () => {
    const turn = (path: string, body: Record<string, unknown> = {}) =>
      request(app)
        .post(`/api/v1/housekeeping/rooms/${roomId}/${path}`)
        .set('Authorization', bearer())
        .set('X-Property-Id', propertyId)
        .send(body);

    expect((await turn('start')).status).toBe(200);

    // Compliance gate (Phase 3): inspect refuses until the checklist is done.
    expect((await turn('inspect')).status).toBe(409);
    const checks = await request(app)
      .get(`/api/v1/housekeeping/rooms/${roomId}/checks`)
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId);
    expect(checks.status).toBe(200);
    for (const item of checks.body.items) {
      expect((await turn('checks', { item_id: item.id, checked: true })).status).toBe(200);
    }

    expect((await turn('inspect')).status).toBe(200);
    expect((await turn('ready')).status).toBe(200);

    const room = await request(app).get(`/api/v1/rooms/${roomId}`).set('Authorization', bearer()).set('X-Property-Id', propertyId);
    expect(room.body.housekeeping_status).toBe('READY');

    const queue = await request(app).get('/api/v1/housekeeping/queue').set('Authorization', bearer()).set('X-Property-Id', propertyId);
    expect(queue.body.data.some((t: { room_id: string }) => t.room_id === roomId)).toBe(false);

    // Readiness gate now opens: the previously-blocked guest can check in.
    const checkin = await request(app)
      .post('/api/v1/checkins')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId)
      .send({ reservation_id: reservation2Id, guest_count: 1 });
    expect(checkin.status).toBe(201);
  });

  it('serves a unified cockpit board', async () => {
    const res = await request(app)
      .get('/api/v1/cockpit/board')
      .set('Authorization', bearer())
      .set('X-Property-Id', propertyId);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('units');
    expect(res.body).toHaveProperty('arrivals');
    expect(res.body).toHaveProperty('departures');
    expect(res.body).toHaveProperty('housekeeping_queue');
    expect(res.body.units.some((u: { room_id: string }) => u.room_id === roomId)).toBe(true);
  });
});
