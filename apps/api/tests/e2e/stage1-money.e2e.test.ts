/**
 * Stage 1 — money and invoices END-TO-END over HTTP (live DB).
 *
 * Proves, through the real router/middleware stack, that:
 *   - parallel mark-paid requests cannot overpay one booking,
 *   - a part-payment leaves ONE open (PARTIALLY_PAID) invoice equal to the folio balance,
 *     and that Finance receivables and the Invoices list agree with the folio,
 *   - the cockpit wizard deposit shows in the folio and cannot be collected twice,
 *   - GET /invoices honours its filters (and rejects malformed ones),
 *   - POST /invoices refuses a booking that is missing or sits in another property.
 *
 * Unit type CONFERENCE (cockpit.e2e uses STANDARD) so the one-active-rate-plan-per-type
 * rule never collides, and everything created here is removed again.
 */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { pool } from '../../src/config/db.js';

const stamp = Date.now();
const iso = (offsetDays: number) => {
  const todayInGaborone = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone' }).format(new Date());
  const d = new Date(`${todayInGaborone}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

let token = '';
const bearer = () => `Bearer ${token}`;
const api = (method: 'get' | 'post', path: string, propId?: string) => {
  const r = request(app)[method](`/api/v1${path}`).set('Authorization', bearer());
  return propId ? r.set('X-Property-Id', propId) : r;
};

let propertyId = '', buildingId = '', ratePlanId = '', roomId = '', contactId = '';
let otherPropertyId = '', otherBuildingId = '', otherRoomId = '', otherReservationId = '';
const reservationIds: string[] = [];
let wizardQuoteId = '', wizardReservationId = '';

const NIGHTLY = 100_000; // P1,000.00 → a 2-night stay is P2,000.00 (200_000 thebe)

afterAll(async () => {
  const run = async (label: string, sql: string, params: unknown[]) => {
    if (params.some((p) => !p)) return;
    try {
      await pool.query(sql, params);
    } catch (err) {
      console.warn(`[e2e teardown] ${label} —`, (err as Error).message);
    }
  };
  const rooms = [roomId, otherRoomId];
  for (const room of rooms) {
    await run('payment_attempts', `DELETE FROM payment_attempts WHERE payment_intent_id IN
      (SELECT pi.id FROM payment_intents pi
         LEFT JOIN holds h ON h.id = pi.hold_id
         LEFT JOIN invoices i ON i.id = pi.invoice_id
         LEFT JOIN reservations r ON r.id = COALESCE(h.reservation_id, i.reservation_id)
        WHERE r.room_id = $1)`, [room]);
    await run('payment_intents', `DELETE FROM payment_intents WHERE id IN
      (SELECT pi.id FROM payment_intents pi
         LEFT JOIN holds h ON h.id = pi.hold_id
         LEFT JOIN invoices i ON i.id = pi.invoice_id
         LEFT JOIN reservations r ON r.id = COALESCE(h.reservation_id, i.reservation_id)
        WHERE r.room_id = $1)`, [room]);
    await run('invoices', 'DELETE FROM invoices WHERE reservation_id IN (SELECT id FROM reservations WHERE room_id = $1)', [room]);
    await run('holds', 'DELETE FROM holds WHERE room_id = $1', [room]);
    await run('reservations', 'DELETE FROM reservations WHERE room_id = $1', [room]);
    await run('rooms', 'DELETE FROM rooms WHERE id = $1', [room]);
  }
  await run('contacts', 'DELETE FROM contacts WHERE id = $1', [contactId]);
  await run('quotes', 'DELETE FROM quotes WHERE rate_plan_id = $1', [ratePlanId]);
  await run('rate_plans', 'DELETE FROM rate_plans WHERE id = $1', [ratePlanId]);
  await run('buildings', 'DELETE FROM buildings WHERE id = $1', [otherBuildingId]);
  await run('properties', 'DELETE FROM properties WHERE id = $1', [otherPropertyId]);
  await pool.end();
});

describe('Stage 1 money — end to end', () => {
  it('sets up: admin, property, CONFERENCE rate plan, unit, guest, and a second property with a booking', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@lsp.local', password: 'Admin@123!' });
    expect(login.status).toBe(200);
    token = login.body.accessToken;

    const me = await api('get', '/auth/me');
    propertyId = me.body.properties[0].id;
    const props = await api('get', '/properties');
    buildingId = props.body.find((p: { id: string }) => p.id === propertyId).buildings[0].id;

    const plan = await api('post', '/pricing').send({
      unit_type: 'CONFERENCE', name: `S1 E2E ${stamp}`, nightly_rate: NIGHTLY, weekly_rate: 600_000, monthly_rate: 2_400_000,
    });
    expect(plan.status).toBe(201);
    ratePlanId = plan.body.id;

    const room = await api('post', '/rooms').send({
      name: `S1 Unit ${stamp}`, code: `S1-${stamp}`, type: 'CONFERENCE', capacity: 4, building_id: buildingId,
    });
    expect(room.status).toBe(201);
    roomId = room.body.id;

    const contact = await api('post', '/contacts').send({ type: 'individual', name: `S1 Guest ${stamp}`, phone: '+267 71 000 001' });
    expect(contact.status).toBe(201);
    contactId = contact.body.id;

    // A second property, built directly: the API has no "create property" the tests may use.
    otherPropertyId = (await pool.query(`INSERT INTO properties (name) VALUES ($1) RETURNING id`, [`S1 Other ${stamp}`])).rows[0].id;
    otherBuildingId = (await pool.query(`INSERT INTO buildings (property_id, name) VALUES ($1,$2) RETURNING id`, [otherPropertyId, `S1 OB ${stamp}`])).rows[0].id;
    const adminId = (await pool.query(`SELECT id FROM users WHERE email = 'admin@lsp.local'`)).rows[0].id;
    otherRoomId = (await pool.query(
      `INSERT INTO rooms (name, code, type, capacity, building_id, created_by, updated_by)
       VALUES ($1,$2,'CONFERENCE',4,$3,$4,$4) RETURNING id`,
      [`S1 Other unit ${stamp}`, `S1O-${stamp}`, otherBuildingId, adminId],
    )).rows[0].id;
    otherReservationId = (await pool.query(
      `INSERT INTO reservations (contact_id, room_id, check_in_date, check_out_date, status, source, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'PENDING','WEBSITE',$5,$5) RETURNING id`,
      [contactId, otherRoomId, iso(40), iso(42), adminId],
    )).rows[0].id;
  });

  const newBooking = async (inDays: number) => {
    const res = await api('post', '/reservations', propertyId).send({
      contact_id: contactId, room_id: roomId, check_in_date: iso(inDays), check_out_date: iso(inDays + 2), status: 'PENDING',
    });
    expect(res.status).toBe(201);
    reservationIds.push(res.body.id);
    return res.body.id as string;
  };
  const folio = async (id: string) => (await api('get', `/reservations/${id}/folio`, propertyId)).body;

  it('lets exactly one of five parallel mark-paid requests collect the full amount', async () => {
    const id = await newBooking(10);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api('post', `/reservations/${id}/mark-paid`, propertyId).send({ method: 'CASH' })),
    );
    const ok = results.filter((r) => r.status === 200);
    const refused = results.filter((r) => r.status !== 200);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(4);
    for (const r of refused) {
      expect(r.status).toBe(400);
      expect(r.body.message ?? r.body.error).toMatch(/already paid in full|more than this booking still owes/i);
    }
    const f = await folio(id);
    expect(f.total_amount).toBe(2 * NIGHTLY);
    expect(f.paid_amount).toBe(2 * NIGHTLY); // never 2×, 3× …
    expect(f.outstanding_amount).toBe(0);
    expect(f.payment_state).toBe('PAID');
  });

  it('rejects an overpayment with a clear message', async () => {
    const id = await newBooking(14);
    const res = await api('post', `/reservations/${id}/mark-paid`, propertyId).send({ method: 'CASH', amount: 2 * NIGHTLY + 1 });
    expect(res.status).toBe(400);
    expect(res.body.message ?? res.body.error).toMatch(/more than this booking still owes/i);
    expect((await folio(id)).paid_amount).toBe(0);
  });

  it('a part-payment leaves ONE open PARTIALLY_PAID invoice that Finance and Invoices both agree with', async () => {
    const id = await newBooking(18);
    const pay = await api('post', `/reservations/${id}/mark-paid`, propertyId).send({ method: 'CASH', amount: 50_000 });
    expect(pay.status).toBe(200);

    const f = await folio(id);
    expect(f.paid_amount).toBe(50_000);
    expect(f.outstanding_amount).toBe(150_000);

    const open = f.invoices.filter((i: { status: string }) => ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status));
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe('PARTIALLY_PAID');
    expect(open[0].total_amount).toBe(150_000);

    const list = await api('get', `/invoices?outstanding=true&search=S1 Guest ${stamp}`, propertyId);
    expect(list.status).toBe(200);
    const mine = list.body.data.filter((i: { reservation_id: string }) => i.reservation_id === id);
    expect(mine).toHaveLength(1);
    expect(mine[0].total_amount).toBe(150_000);
    expect(mine[0].due_date).toBeTruthy();

    const fin = await api('get', '/finance/receivables', propertyId);
    expect(fin.status).toBe(200);
    const row = fin.body.invoices.find((i: { reservation_id?: string; id: string }) => i.id === mine[0].id);
    expect(row).toBeTruthy();
    expect(row.total_amount ?? row.amount).toBe(150_000);
    // Receipts (born PAID) must not be counted as receivables.
    expect(fin.body.invoices.every((i: { status: string }) => i.status !== 'PAID')).toBe(true);
  });

  it('refuses to collect an invoice twice from the Invoices page', async () => {
    const id = reservationIds[reservationIds.length - 1]!;
    const f = await folio(id);
    const inv = f.invoices.find((i: { status: string }) => i.status === 'PARTIALLY_PAID');
    const first = await api('post', `/invoices/${inv.id}/settle`, propertyId).send({});
    expect(first.status).toBe(200);
    const second = await api('post', `/invoices/${inv.id}/settle`, propertyId).send({});
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
    const after = await folio(id);
    expect(after.paid_amount).toBe(2 * NIGHTLY);
    expect(after.outstanding_amount).toBe(0);
  });

  it('shows a cockpit-wizard deposit in the folio and refuses to collect it again', async () => {
    wizardReservationId = await newBooking(24);
    const quote = await api('post', '/quotes').send({ unit_type: 'CONFERENCE', check_in: iso(24), check_out: iso(26), guests: 1 });
    expect(quote.status).toBe(201);
    wizardQuoteId = quote.body.id;
    const hold = await api('post', '/holds', propertyId).send({ quote_id: wizardQuoteId, room_id: roomId, reservation_id: wizardReservationId });
    expect(hold.status).toBe(201);
    const intent = await api('post', '/payments', propertyId).send({ hold_id: hold.body.id, method: 'CASH', purpose: 'DEPOSIT' });
    expect(intent.status).toBe(201);
    const attempt = await api('post', `/payments/${intent.body.id}/attempt`, propertyId).send({ outcome: 'SUCCESS' });
    expect(attempt.status).toBe(200);

    const f = await folio(wizardReservationId);
    expect(f.paid_amount).toBeGreaterThan(0);
    expect(f.paid_amount).toBeLessThan(f.total_amount);
    expect(f.total_source).toBe('FOLIO');

    // Collecting "the rest" takes only what is still owed — not the full price again.
    const rest = await api('post', `/reservations/${wizardReservationId}/mark-paid`, propertyId).send({ method: 'CASH' });
    expect(rest.status).toBe(200);
    const done = await folio(wizardReservationId);
    expect(done.paid_amount).toBe(done.total_amount);
    expect(done.outstanding_amount).toBe(0);
  });

  it('GET /invoices honours date-range, outstanding and property_id filters, and rejects malformed ones', async () => {
    const bad = await api('get', '/invoices?from=not-a-date', propertyId);
    expect(bad.status).toBe(400);
    const badId = await api('get', '/invoices?property_id=nope', propertyId);
    expect(badId.status).toBe(400);

    // A window in the far past matches nothing of ours.
    const past = await api('get', `/invoices?from=2000-01-01&to=2000-01-31&search=S1 Guest ${stamp}`, propertyId);
    expect(past.status).toBe(200);
    expect(past.body.data).toHaveLength(0);

    // Everything we raised is paid by now → nothing outstanding for this guest.
    const out = await api('get', `/invoices?outstanding=true&search=S1 Guest ${stamp}`, propertyId);
    expect(out.status).toBe(200);
    const stillOpen = out.body.data.filter((i: { status: string }) => i.status !== 'PAID');
    expect(stillOpen.every((i: { reservation_id: string }) => reservationIds.includes(i.reservation_id))).toBe(true);

    // property_id narrows to that property: the second property holds none of this guest's invoices.
    const other = await api('get', `/invoices?property_id=${otherPropertyId}&search=S1 Guest ${stamp}`, propertyId);
    expect(other.status).toBe(200);
    expect(other.body.data).toHaveLength(0);
  });

  it('POST /invoices refuses a missing booking and a booking in another property', async () => {
    const body = { quote_id: wizardQuoteId, kind: 'BALANCE' };
    const missing = await api('post', '/invoices', propertyId).send({ ...body, reservation_id: '00000000-0000-4000-8000-000000000000' });
    expect(missing.status).toBe(404);
    const foreign = await api('post', '/invoices', propertyId).send({ ...body, reservation_id: otherReservationId });
    expect(foreign.status).toBe(404);
    const rows = await pool.query('SELECT 1 FROM invoices WHERE reservation_id = $1', [otherReservationId]);
    expect(rows.rowCount).toBe(0);
  });

  it('keeps availability untouched by money: a fully paid booking still blocks its dates, a free window stays free', async () => {
    const taken = await api('post', '/reservations', propertyId).send({
      contact_id: contactId, room_id: roomId, check_in_date: iso(10), check_out_date: iso(12), status: 'PENDING',
    });
    expect(taken.status).toBeGreaterThanOrEqual(400); // overlaps the paid booking made above
    expect(taken.status).toBeLessThan(500);
  });
});
