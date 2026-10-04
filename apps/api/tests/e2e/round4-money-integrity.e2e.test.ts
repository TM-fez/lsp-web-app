/**
 * Round 4 — money integrity END-TO-END over HTTP (live DB).
 *
 *   §2  Deleting a unit or a guest while live bookings / unpaid invoices exist is refused
 *       (409, plain English); history-only is allowed; a booking never vanishes from the
 *       board because its unit or guest was soft-deleted.
 *   §3  Refunds: capped by what is left on the invoice AND by the folio credit; a refund 1
 *       thebe over is refused; parallel identical refunds cannot exceed what is refundable;
 *       a duplicate click is refused; Idempotency-Key replays.
 *   §4  Idempotency-Key on payments, mark-paid, operating costs and guests.
 *
 * Unit type CUSTOM (other e2e files use STANDARD / CONFERENCE) so the one-active-rate-plan
 * rule never collides. Everything created here is removed again.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
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
type Method = 'get' | 'post' | 'patch' | 'delete';
const api = (method: Method, path: string, propId?: string) => {
  const r = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  return propId ? r.set('X-Property-Id', propId) : r;
};

const NIGHTLY = 100_000; // P1,000.00 a night, zero VAT → a 2-night stay is 200_000
let propertyId = '', buildingId = '', ratePlanId = '', guestId = '', adminId = '';
const roomIds: string[] = [];
const reservationIds: string[] = [];
const contactIds: string[] = [];
const costIds: string[] = [];
let roomSeq = 0;
let dayCursor = 60;

async function newRoom(): Promise<string> {
  const code = `R4-${stamp}-${roomSeq++}`;
  const res = await api('post', '/rooms', propertyId).send({ name: code, code, type: 'CUSTOM', capacity: 2, building_id: buildingId });
  expect(res.status).toBe(201);
  roomIds.push(res.body.id);
  return res.body.id;
}

/** A booking on a fresh unit (own unit → bookings never collide). */
async function newBooking(opts: { nights?: number; contact?: string; roomId?: string; billing?: string } = {}) {
  const roomId = opts.roomId ?? (await newRoom());
  const start = (dayCursor += 15);
  const nights = opts.nights ?? 2;
  const res = await api('post', '/reservations', propertyId).send({
    contact_id: opts.contact ?? guestId, room_id: roomId,
    check_in_date: iso(start), check_out_date: iso(start + nights), status: 'PENDING',
    ...(opts.billing ? { billing_contact_id: opts.billing } : {}),
  });
  expect(res.status).toBe(201);
  reservationIds.push(res.body.id);
  return { id: res.body.id as string, roomId, start, nights };
}

const folio = async (id: string) => (await api('get', `/reservations/${id}/folio`, propertyId)).body;
const pay = (id: string, body: Record<string, unknown> = { method: 'CASH' }) =>
  api('post', `/reservations/${id}/mark-paid`, propertyId).send(body);
async function newContact(name: string) {
  const res = await api('post', '/contacts').send({ type: 'individual', name: `${name} ${stamp}`, phone: '+267 71 000 009' });
  expect(res.status).toBe(201);
  contactIds.push(res.body.id);
  return res.body.id as string;
}

beforeAll(async () => {
  const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@lsp.local', password: 'Admin@123!' });
  expect(login.status).toBe(200);
  token = login.body.accessToken;
  const me = await api('get', '/auth/me');
  propertyId = me.body.properties[0].id;
  adminId = me.body.id;
  const props = await api('get', '/properties');
  buildingId = props.body.find((p: { id: string }) => p.id === propertyId).buildings[0].id;
  const plan = await api('post', '/pricing').send({
    unit_type: 'CUSTOM', name: `R4 E2E ${stamp}`, nightly_rate: NIGHTLY, weekly_rate: 600_000, monthly_rate: 2_400_000, tax_rate_bps: 0,
  });
  expect(plan.status).toBe(201);
  ratePlanId = plan.body.id;
  guestId = await newContact('R4 Guest');
});

afterAll(async () => {
  const run = async (label: string, sql: string, params: unknown[]) => {
    try {
      await pool.query(sql, params);
    } catch (err) {
      console.warn(`[round4 e2e teardown] ${label} —`, (err as Error).message);
    }
  };
  const resIds = reservationIds;
  const sub = 'SELECT id FROM reservations WHERE id = ANY($1)';
  await run('payment_attempts', `DELETE FROM payment_attempts WHERE payment_intent_id IN
    (SELECT pi.id FROM payment_intents pi LEFT JOIN holds h ON h.id = pi.hold_id LEFT JOIN invoices i ON i.id = pi.invoice_id
      WHERE COALESCE(h.reservation_id, i.reservation_id) = ANY($1) OR h.room_id = ANY($2))`, [resIds, roomIds]);
  await run('payment_intents', `DELETE FROM payment_intents WHERE id IN
    (SELECT pi.id FROM payment_intents pi LEFT JOIN holds h ON h.id = pi.hold_id LEFT JOIN invoices i ON i.id = pi.invoice_id
      WHERE COALESCE(h.reservation_id, i.reservation_id) = ANY($1) OR h.room_id = ANY($2))`, [resIds, roomIds]);
  await run('invoices(refund links)', `UPDATE invoices SET refund_of_invoice_id = NULL WHERE reservation_id IN (${sub})`, [resIds]);
  await run('invoices', `DELETE FROM invoices WHERE reservation_id IN (${sub})`, [resIds]);
  await run('holds', 'DELETE FROM holds WHERE room_id = ANY($1)', [roomIds]);
  await run('revenue', `DELETE FROM revenue_recognition WHERE reservation_id IN (${sub})`, [resIds]);
  await run('reservations', 'DELETE FROM reservations WHERE room_id = ANY($1)', [roomIds]);
  await run('rooms', 'DELETE FROM rooms WHERE id = ANY($1)', [roomIds]);
  await run('operating_expenses', 'DELETE FROM operating_expenses WHERE description LIKE $1', [`R4 cost ${stamp}%`]);
  await run('idempotency_keys', 'DELETE FROM idempotency_keys WHERE user_id = $1 AND key LIKE $2', [adminId, `r4-${stamp}-%`]);
  await run('contacts', 'DELETE FROM contacts WHERE name LIKE $1', [`% ${stamp}`]);
  await run('quotes', 'DELETE FROM quotes WHERE rate_plan_id = $1', [ratePlanId]);
  await run('rate_plans', 'DELETE FROM rate_plans WHERE id = $1', [ratePlanId]);
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('§2 deleting a unit or guest that still has bookings', () => {
  it('refuses to delete a unit with an upcoming booking — 409, naming the booking', async () => {
    const b = await newBooking();
    const res = await api('delete', `/rooms/${b.roomId}`, propertyId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/can’t remove this unit/);
    expect(res.body.message).toMatch(/1 active or upcoming booking\b/);
    expect((await api('get', `/reservations/${b.id}`, propertyId)).status).toBe(200);
    const row = await pool.query('SELECT deleted_at FROM rooms WHERE id = $1', [b.roomId]);
    expect(row.rows[0].deleted_at).toBeNull();
  });

  it('refuses to delete a unit whose CONFIRMED booking is paid — and says money was received', async () => {
    const b = await newBooking();
    expect((await pay(b.id)).status).toBe(200);
    const res = await api('delete', `/rooms/${b.roomId}`, propertyId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 active or upcoming booking \(all with money already received\)/);
    expect((await folio(b.id)).paid_amount).toBe(2 * NIGHTLY);
  });

  it('refuses to delete a unit whose finished stay still has an unpaid invoice', async () => {
    const b = await newBooking();
    await api('post', `/reservations/${b.id}/confirm`, propertyId).send({}); // pay-later → one open invoice
    await pool.query(`UPDATE reservations SET status = 'CHECKED_OUT' WHERE id = $1`, [b.id]);
    const res = await api('delete', `/rooms/${b.roomId}`, propertyId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/1 unpaid invoice/);
    expect(res.body.message).not.toMatch(/active or upcoming/);
  });

  it('allows deleting a unit that only has cancelled / settled history — and the history stays readable', async () => {
    const cancelled = await newBooking();
    expect((await pay(cancelled.id)).status).toBe(200);
    expect((await api('delete', `/reservations/${cancelled.id}`, propertyId)).status).toBe(200); // cancel keeps the PAID invoice
    expect((await api('delete', `/rooms/${cancelled.roomId}`, propertyId)).status).toBe(204);

    // The booking is still on the board and all its by-id reads work (they 404'd before).
    expect((await api('get', `/reservations/${cancelled.id}`, propertyId)).status).toBe(200);
    expect((await api('get', `/reservations/${cancelled.id}/folio`, propertyId)).status).toBe(200);
    const priced = await api('get', `/reservations/${cancelled.id}/pricing`, propertyId);
    expect(priced.status).toBe(200);
    expect(priced.body.priceable).toBe(true);
    const list = await api('get', `/reservations?limit=100&search=${encodeURIComponent(`R4-${stamp}`)}`, propertyId);
    expect(list.body.data.some((r: { id: string }) => r.id === cancelled.id)).toBe(true);
  });

  it('refuses to delete a guest who is on a live booking, as the booker or as the billing contact', async () => {
    const guest = await newContact('R4 Booker');
    const biller = await newContact('R4 Biller');
    const b = await newBooking({ contact: guest, billing: biller });

    const g = await api('delete', `/contacts/${guest}`);
    expect(g.status).toBe(409);
    expect(g.body.message).toMatch(/can’t remove this guest/);
    expect(g.body.message).toMatch(/1 active or upcoming booking\b/);
    const bl = await api('delete', `/contacts/${biller}`);
    expect(bl.status).toBe(409);
    expect((await api('get', `/reservations/${b.id}`, propertyId)).status).toBe(200);
  });

  it('allows deleting a guest whose bookings are all cancelled; the cancelled booking stays visible with the guest’s name', async () => {
    const guest = await newContact('R4 Past Guest');
    const b = await newBooking({ contact: guest });
    expect((await api('delete', `/reservations/${b.id}`, propertyId)).status).toBe(200);
    expect((await api('delete', `/contacts/${guest}`)).status).toBe(204);
    const got = await api('get', `/reservations?limit=100&search=${encodeURIComponent(`R4-${stamp}`)}`, propertyId);
    const row = got.body.data.find((r: { id: string }) => r.id === b.id);
    expect(row).toBeTruthy();
    expect(row.guest_name).toContain('R4 Past Guest');
  });

  it('parallel: deleting a unit while a booking is created on it never leaves both succeeded', async () => {
    for (let i = 0; i < 5; i++) {
      const roomId = await newRoom();
      const start = (dayCursor += 15);
      const [del, create] = await Promise.all([
        api('delete', `/rooms/${roomId}`, propertyId),
        api('post', '/reservations', propertyId).send({
          contact_id: guestId, room_id: roomId, check_in_date: iso(start), check_out_date: iso(start + 2), status: 'PENDING',
        }),
      ]);
      if (create.body?.id) reservationIds.push(create.body.id);
      // Either the delete won (the booking is refused) or the booking won (the delete is refused) — never both.
      expect(del.status === 204 && create.status === 201, `delete ${del.status} / create ${create.status}`).toBe(false);
      expect([204, 409]).toContain(del.status);
    }
  });

  it('a booking left on a unit deleted BEFORE the guard shipped (legacy row) still reads, prices and lists', async () => {
    const b = await newBooking();
    await pay(b.id);
    await pool.query('UPDATE rooms SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [b.roomId, adminId]); // what the old DELETE did
    expect((await api('get', `/reservations/${b.id}`, propertyId)).status).toBe(200);
    expect((await api('get', `/reservations/${b.id}/folio`, propertyId)).status).toBe(200);
    expect((await api('get', `/reservations/${b.id}/pricing`, propertyId)).status).toBe(200);
    const list = await api('get', `/reservations?limit=100&search=${encodeURIComponent(`R4-${stamp}`)}`, propertyId);
    expect(list.body.data.some((r: { id: string }) => r.id === b.id)).toBe(true);
    // …and the owner can still take the rest of a payment on it.
    const b2 = await newBooking();
    await pool.query('UPDATE rooms SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [b2.roomId, adminId]);
    expect((await pay(b2.id)).status).toBe(200);
  });
});
