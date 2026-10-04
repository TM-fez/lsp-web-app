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

// ─────────────────────────────────────────────────────────────────────────────────────
describe('§3 refunds', () => {
  const refund = (invoiceId: string, body: Record<string, unknown>, key?: string) => {
    const r = api('post', `/invoices/${invoiceId}/refund`, propertyId);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };
  async function paidBooking(nights = 2) {
    const b = await newBooking({ nights });
    expect((await pay(b.id)).status).toBe(200);
    const inv = await pool.query(
      `SELECT id, total_amount FROM invoices WHERE reservation_id = $1 AND kind <> 'REFUND' AND status = 'PAID'`, [b.id]);
    expect(inv.rows).toHaveLength(1);
    return { ...b, invoiceId: inv.rows[0].id as string, total: Number(inv.rows[0].total_amount) };
  }
  const creditNotes = async (invoiceId: string) =>
    Number((await pool.query(`SELECT count(*) c FROM invoices WHERE refund_of_invoice_id = $1 AND kind = 'REFUND' AND deleted_at IS NULL`, [invoiceId])).rows[0].c);
  const shorten = async (b: { id: string; start: number }, toNights: number) =>
    expect((await api('patch', `/reservations/${b.id}`, propertyId).send({ check_out_date: iso(b.start + toNights) })).status).toBe(200);

  it('a stay shortened after payment: a refund 1 thebe above the credit is refused, the credit itself goes through', async () => {
    const b = await paidBooking(4); // P4,000.00 paid
    await shorten(b, 1);
    const f = await folio(b.id);
    expect(f.credit_amount).toBe(3 * NIGHTLY);

    const over = await refund(b.invoiceId, { amount: f.credit_amount + 1, reason: 'one thebe too many' });
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/shortened after payment, so only BWP 3,000\.00 is owed back/);
    expect(await creditNotes(b.invoiceId)).toBe(0);
    expect((await folio(b.id)).total_amount).toBe(NIGHTLY); // untouched by the refused request

    const ok = await refund(b.invoiceId, { amount: f.credit_amount, reason: 'nights not stayed' });
    expect(ok.status).toBe(201);
    const after = await folio(b.id);
    expect(after.total_amount).toBe(NIGHTLY);   // the credit is settled, the agreed total does not move
    expect(after.paid_amount).toBe(NIGHTLY);
    expect(after.credit_amount).toBe(0);
  });

  it('an ordinary refund is capped by what is left on the invoice, to the thebe', async () => {
    const b = await paidBooking(2); // P2,000.00
    expect((await refund(b.invoiceId, { amount: b.total + 1, reason: 'x' })).status).toBe(400);
    expect((await refund(b.invoiceId, { amount: 50_000, reason: 'goodwill' })).status).toBe(201);
    const over = await refund(b.invoiceId, { amount: b.total - 50_000 + 1, reason: 'x' });
    expect(over.status).toBe(409);
    expect(over.body.message).toMatch(/Only BWP 1,500\.00 of this invoice is left to refund\. BWP 500\.00 has already been refunded/);
    expect((await refund(b.invoiceId, { amount: b.total - 50_000, reason: 'rest' })).status).toBe(201);
    expect(await creditNotes(b.invoiceId)).toBe(2);
  });

  it('4 parallel identical refunds without a key: exactly one goes through (duplicate guard), the rest get a clear 409', async () => {
    const b = await paidBooking(2);
    const out = await Promise.all(Array.from({ length: 4 }, () => refund(b.invoiceId, { amount: 10_000, reason: 'double click' })));
    expect(out.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    for (const r of out.filter((x) => x.status === 409)) expect(r.body.message).toMatch(/looks like a duplicate refund — wait or use a different amount/);
    expect(await creditNotes(b.invoiceId)).toBe(1);
    expect((await folio(b.id)).paid_amount).toBe(b.total - 10_000);
  });

  it('parallel identical refunds that would together exceed what is left never over-refund', async () => {
    const b = await paidBooking(2); // P2,000.00; 4 × P600.00 would be P2,400.00
    const out = await Promise.all(Array.from({ length: 4 }, () => refund(b.invoiceId, { amount: 60_000, reason: 'race' }, undefined)));
    expect(out.filter((r) => r.status === 201)).toHaveLength(1); // duplicate guard; and even without it the cap holds
    const refunded = Number((await pool.query(`SELECT COALESCE(sum(total_amount),0) s FROM invoices WHERE refund_of_invoice_id = $1 AND kind='REFUND'`, [b.invoiceId])).rows[0].s);
    expect(refunded).toBeLessThanOrEqual(b.total);
  });

  it('two DIFFERENT amounts that both fit are both legitimate, in parallel too', async () => {
    const b = await paidBooking(2);
    const out = await Promise.all([refund(b.invoiceId, { amount: 10_000, reason: 'a' }), refund(b.invoiceId, { amount: 20_000, reason: 'b' })]);
    expect(out.map((r) => r.status)).toEqual([201, 201]);
    expect(await creditNotes(b.invoiceId)).toBe(2);
  });

  it('the cap alone (no duplicate guard) stops parallel refunds from exceeding the invoice — distinct keys, same amount', async () => {
    const b = await paidBooking(2); // P2,000.00; 4 × P600.00 with distinct keys: each is "deliberate"
    const out = await Promise.all(
      Array.from({ length: 4 }, (_, i) => refund(b.invoiceId, { amount: 60_000, reason: 'distinct' }, `r4-${stamp}-cap-${b.id}-${i}`))
    );
    expect(out.map((r) => r.status).sort()).toEqual([201, 201, 201, 409]); // 3 × 600 = 1,800 fit; the 4th would make 2,400
    expect(out.find((r) => r.status === 409)!.body.message).toMatch(/left to refund/);
    expect(await creditNotes(b.invoiceId)).toBe(3);
  });

  it('with an Idempotency-Key a retry replays the same refund instead of refunding twice', async () => {
    const b = await paidBooking(2);
    const key = `r4-${stamp}-refund-${b.id}`;
    const first = await refund(b.invoiceId, { amount: 25_000, reason: 'retry' }, key);
    const again = await refund(b.invoiceId, { amount: 25_000, reason: 'retry' }, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await creditNotes(b.invoiceId)).toBe(1);
    // …and 4 parallel with the one key do it once as well.
    const key2 = `r4-${stamp}-refund-par-${b.id}`;
    const par = await Promise.all(Array.from({ length: 4 }, () => refund(b.invoiceId, { amount: 30_000, reason: 'par' }, key2)));
    expect(par.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(par.map((r) => r.body.id)).size).toBe(1);
    expect(await creditNotes(b.invoiceId)).toBe(2);
  });

  it('the same key with a different amount is 422 and refunds nothing', async () => {
    const b = await paidBooking(2);
    const key = `r4-${stamp}-refund-422-${b.id}`;
    expect((await refund(b.invoiceId, { amount: 10_000, reason: 'x' }, key)).status).toBe(201);
    const other = await refund(b.invoiceId, { amount: 10_001, reason: 'x' }, key);
    expect(other.status).toBe(422);
    expect(await creditNotes(b.invoiceId)).toBe(1);
  });

  it('a refused refund frees its key: the corrected amount can be sent with the same key', async () => {
    const b = await paidBooking(2);
    const key = `r4-${stamp}-refund-free-${b.id}`;
    expect((await refund(b.invoiceId, { amount: b.total + 1, reason: 'typo' }, key)).status).toBe(400);
    expect((await refund(b.invoiceId, { amount: 10_000, reason: 'fixed' }, key)).status).toBe(201);
  });

  it('audit rows for the refund and the lowered total are written with it', async () => {
    const b = await paidBooking(2);
    const r = await refund(b.invoiceId, { amount: 12_345, reason: 'audit me' });
    expect(r.status).toBe(201);
    const audit = await pool.query(
      `SELECT diff FROM audit_logs WHERE entity = 'invoices' AND entity_id = $1 AND diff->>'credit_note_id' = $2`, [b.invoiceId, r.body.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].diff.reason).toBe('audit me');
    const lowered = await pool.query(
      `SELECT 1 FROM audit_logs WHERE entity = 'reservations' AND entity_id = $1 AND diff->>'reason' = 'refund lowers the agreed total'`, [b.id]);
    expect(lowered.rows).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
describe('§4 Idempotency-Key on the other money-moving POSTs', () => {
  const N = 4;

  it('POST /contacts: 4 parallel with one key → one guest; a different body with that key → 422', async () => {
    const key = `r4-${stamp}-contact`;
    const name = `R4 Dbl ${stamp}`;
    const body = { type: 'individual', name, phone: '+267 71 000 010' };
    const out = await Promise.all(Array.from({ length: N }, () => api('post', '/contacts').set('Idempotency-Key', key).send(body)));
    expect(out.map((r) => r.status)).toEqual(Array(N).fill(201));
    expect(new Set(out.map((r) => r.body.id)).size).toBe(1);
    contactIds.push(out[0].body.id);
    const rows = await pool.query('SELECT count(*) c FROM contacts WHERE name = $1 AND deleted_at IS NULL', [name]);
    expect(Number(rows.rows[0].c)).toBe(1);
    const diff = await api('post', '/contacts').set('Idempotency-Key', key).send({ ...body, name: `${name} B` });
    expect(diff.status).toBe(422);
  });

  it('POST /contacts without a key behaves as before (no hidden de-duplication)', async () => {
    const body = { type: 'individual', name: `R4 NoKey ${stamp}`, phone: '+267 71 000 011' };
    const a = await api('post', '/contacts').send(body);
    const b = await api('post', '/contacts').send(body);
    expect([a.status, b.status]).toEqual([201, 201]);
    contactIds.push(a.body.id, b.body.id);
  });

  it('POST /operating-expenses: 4 parallel with one key → one cost row', async () => {
    const key = `r4-${stamp}-opex`;
    const body = { category: 'OTHER', description: `R4 cost ${stamp}`, amount: 12_345, incurred_on: iso(-1), property_id: propertyId };
    const out = await Promise.all(Array.from({ length: N }, () => api('post', '/operating-expenses').set('Idempotency-Key', key).send(body)));
    expect(out.map((r) => r.status)).toEqual(Array(N).fill(201));
    expect(new Set(out.map((r) => r.body.id)).size).toBe(1);
    const rows = await pool.query('SELECT count(*) c FROM operating_expenses WHERE description = $1 AND deleted_at IS NULL', [body.description]);
    expect(Number(rows.rows[0].c)).toBe(1);
    expect((await api('post', '/operating-expenses').set('Idempotency-Key', key).send({ ...body, amount: 12_346 })).status).toBe(422);
  });

  it('POST /reservations/:id/mark-paid: 4 parallel part-payments with one key → taken once; new key → a second part-payment', async () => {
    const b = await newBooking({ nights: 2 }); // P2,000.00
    const key = `r4-${stamp}-markpaid-${b.id}`;
    const out = await Promise.all(Array.from({ length: N }, () => pay(b.id, { method: 'CASH', amount: 50_000 }).set('Idempotency-Key', key)));
    expect(out.map((r) => r.status)).toEqual(Array(N).fill(200));
    expect((await folio(b.id)).paid_amount).toBe(50_000);
    const different = await pay(b.id, { method: 'CASH', amount: 60_000 }).set('Idempotency-Key', key);
    expect(different.status).toBe(422);
    expect((await folio(b.id)).paid_amount).toBe(50_000);
    expect((await pay(b.id, { method: 'CASH', amount: 50_000 }).set('Idempotency-Key', `${key}-second`)).status).toBe(200);
    expect((await folio(b.id)).paid_amount).toBe(100_000);
  });

  it('POST /payments: 4 parallel with one key → one payment intent', async () => {
    const b = await newBooking({ nights: 2 });
    const q = await api('post', '/quotes', propertyId).send({ unit_type: 'CUSTOM', check_in: iso(b.start), check_out: iso(b.start + 2), guests: 1 });
    expect(q.status).toBe(201);
    const h = await api('post', '/holds', propertyId).send({ quote_id: q.body.id, room_id: b.roomId, reservation_id: b.id });
    expect(h.status).toBe(201);
    const key = `r4-${stamp}-intent-${b.id}`;
    const body = { hold_id: h.body.id, method: 'CASH' };
    const out = await Promise.all(Array.from({ length: N }, () => api('post', '/payments', propertyId).set('Idempotency-Key', key).send(body)));
    expect(out.map((r) => r.status)).toEqual(Array(N).fill(201));
    expect(new Set(out.map((r) => r.body.id)).size).toBe(1);
    const rows = await pool.query('SELECT count(*) c FROM payment_intents WHERE hold_id = $1', [h.body.id]);
    expect(Number(rows.rows[0].c)).toBe(1);
  });

  it('a malformed Idempotency-Key is a 400 before anything is created', async () => {
    const res = await api('post', '/contacts').set('Idempotency-Key', 'x').send({ type: 'individual', name: `R4 Bad ${stamp}` });
    expect(res.status).toBe(400);
  });
});
