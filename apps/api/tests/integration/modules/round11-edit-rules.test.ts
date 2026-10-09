/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 11, N11-1) The booking edit (drawer / PATCH) obeys the same rules as the calendar
 * drag: no re-dating a cancelled booking, no starting a stay in the past, and an in-house
 * guest's arrival day is fixed — except for an admin (owner decision 2026-10-09), who still
 * can't put the stay on top of another booking.
 *
 * Unit type STANDARD, serialised across suites with the advisory lock (one active plan per type).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/config/db.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';
import { todayInPropertyTZ } from '../../../src/core/time.js';
import { lockUnitType } from '../helpers/unitTypeLock.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NIGHTLY = 50_000; // P500 a night, zero-rated so totals are plain multiples
const meta = () => ({ userId, ip: '127.0.0.1', requestId: randomUUID() }) as never;
const service = new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db), new PricingService(new PricingRepository(db)));

let releaseUnitType: () => Promise<void>;
let userId: string, propId: string, otherPropId: string, bldId: string, otherBldId: string, planId: string, guestId: string;
const roomIds: string[] = [];
const reservationIds: string[] = [];

const day = (offset: number) => {
  const d = new Date(`${todayInPropertyTZ()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function unit(code: string, other = false) {
  const id = (await db.insertInto('rooms').values({
    name: `Move ${code}`, code: `E11-${code}-${uniq}`, type: 'STANDARD', capacity: 2,
    building_id: other ? otherBldId : bldId, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  roomIds.push(id);
  return id;
}

async function booking(roomId: string, from: number, to: number, status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'BLOCKED' | 'CANCELLED', folio: number | null, paid = 0) {
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, check_in_date: new Date(day(from)), check_out_date: new Date(day(to)),
    status, source: status === 'BLOCKED' ? 'BOOKING_COM' : 'DIRECT', folio_total_amount: folio,
    created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  reservationIds.push(id);
  if (paid > 0) {
    await db.insertInto('invoices').values({
      number: `INV-E11-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, reservation_id: id, kind: 'DEPOSIT',
      subtotal_amount: paid, tax_rate_bps: 0, tax_amount: 0, total_amount: paid, status: 'PAID',
      issued_by: userId, created_by: userId, updated_by: userId,
    }).execute();
  }
  return id;
}

beforeAll(async () => {
  releaseUnitType = await lockUnitType('STANDARD');
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'Move', email: `e11-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `E11_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  otherPropId = (await db.insertInto('properties').values({ name: `E11_O_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `MVB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  otherBldId = (await db.insertInto('buildings').values({ property_id: otherPropId, name: `MVO_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'STANDARD', name: `E11 Rate ${uniq}`, nightly_rate: NIGHTLY, weekly_rate: NIGHTLY * 7, monthly_rate: NIGHTLY * 30,
    max_guests: 2, deposit_pct: 50, tax_rate_bps: 0, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: 'Garth Miller', created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  try {
    if (reservationIds.length) {
      await db.deleteFrom('housekeeping_tasks').where('room_id', 'in', roomIds).execute();
      await db.deleteFrom('occupancy').where('reservation_id', 'in', reservationIds).execute();
      await db.deleteFrom('revenue_recognition').where('reservation_id', 'in', reservationIds).execute();
      await db.deleteFrom('invoices').where('reservation_id', 'in', reservationIds).execute();
      await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
    }
    await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
    await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
    if (roomIds.length) await db.deleteFrom('rooms').where('id', 'in', roomIds).execute();
    await db.deleteFrom('contacts').where('id', '=', guestId).execute();
    await db.deleteFrom('buildings').where('id', 'in', [bldId, otherBldId]).execute();
    await db.deleteFrom('properties').where('id', 'in', [propId, otherPropId]).execute();
    await db.deleteFrom('users').where('id', '=', userId).execute();
  } finally {
    await releaseUnitType();
  }
});

const status = async (p: Promise<unknown>) => {
  try { await p; return 200; } catch (e) { return (e as { statusCode?: number }).statusCode ?? 500; }
};

describe('booking edit follows the drag rules (N11-1)', () => {
  it('refuses to change a checked-in guest’s arrival day for staff, on the server', async () => {
    const r = await unit('A');
    const id = await booking(r, -1, 3, 'CHECKED_IN', 4 * NIGHTLY);
    expect(await status(service.modifyReservation(id, { check_in_date: day(0) }, meta(), propId))).toBe(403);
    const row = await db.selectFrom('reservations').select('check_in_date').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.check_in_date.toISOString().slice(0, 10)).toBe(day(-1));
    // So tonight stays taken: no second booking on top of the in-house guest.
    const preview = await service.previewMove(id, { check_in_date: day(0) }, propId);
    expect(preview.allowed).toBe(false);
  });

  it('still lets staff change an in-house guest’s leaving day or unit', async () => {
    const r = await unit('B');
    const id = await booking(r, -1, 3, 'CHECKED_IN', 4 * NIGHTLY);
    await service.modifyReservation(id, { check_out_date: day(4) }, meta(), propId);
    // Re-sending the unchanged arrival day (the drawer sends every field) is not a change.
    await service.modifyReservation(id, { check_in_date: day(-1), check_out_date: day(5) }, meta(), propId);
    const row = await db.selectFrom('reservations').select('check_out_date').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.check_out_date.toISOString().slice(0, 10)).toBe(day(5));
  });

  it('lets an admin correct the arrival day — but never onto another booking', async () => {
    const r = await unit('C');
    const id = await booking(r, -2, 3, 'CHECKED_IN', 5 * NIGHTLY);
    await service.modifyReservation(id, { check_in_date: day(-1) }, meta(), propId, true);
    const row = await db.selectFrom('reservations').select('check_in_date').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.check_in_date.toISOString().slice(0, 10)).toBe(day(-1));
    expect((await service.previewMove(id, { check_in_date: day(0) }, propId, true)).allowed).toBe(true);
    // Not even an admin can move an in-house arrival into the future: that frees tonight.
    expect(await status(service.modifyReservation(id, { check_in_date: day(1) }, meta(), propId, true))).toBe(400);

    await booking(r, 3, 6, 'CONFIRMED', 3 * NIGHTLY);
    expect(await status(service.modifyReservation(id, { check_out_date: day(5) }, meta(), propId, true))).toBe(409);
  });

  it('refuses to move a stay to start in the past', async () => {
    const r = await unit('D');
    const id = await booking(r, 5, 7, 'PENDING', 2 * NIGHTLY);
    expect(await status(service.modifyReservation(id, { check_in_date: day(-3), check_out_date: day(-1) }, meta(), propId))).toBe(400);
    expect(await status(service.modifyReservation(id, { check_in_date: day(-3) }, meta(), propId, true))).toBe(400);
  });

  it('refuses to change a cancelled booking’s dates, but still saves its other fields', async () => {
    const r = await unit('E');
    const id = await booking(r, 5, 7, 'CANCELLED', 2 * NIGHTLY);
    expect(await status(service.modifyReservation(id, { check_in_date: day(8), check_out_date: day(9) }, meta(), propId))).toBe(409);
    expect(await status(service.modifyReservation(id, { room_id: await unit('E2') }, meta(), propId))).toBe(409);
    await service.modifyReservation(id, { check_in_date: day(5), check_out_date: day(7), notes: 'Called to apologise' }, meta(), propId);
    const row = await db.selectFrom('reservations').select(['check_in_date', 'notes']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.check_in_date.toISOString().slice(0, 10)).toBe(day(5));
    expect(row.notes).toBe('Called to apologise');
  });
});

describe('drag preview and calendar polish (Round 11)', () => {
  it('says what is in the way: another booking, or a closure', async () => {
    const r = await unit('F');
    const id = await booking(r, 10, 12, 'CONFIRMED', 2 * NIGHTLY);
    const busy = await unit('F2');
    await booking(busy, 10, 12, 'PENDING', 2 * NIGHTLY);
    expect((await service.previewMove(id, { room_id: busy }, propId)).reason).toBe(
      'That unit isn’t free for those nights — another booking is in the way.'
    );
    const closed = await unit('F3');
    await db.updateTable('rooms').set({ status: 'MAINTENANCE' }).where('id', '=', closed).execute();
    expect((await service.previewMove(id, { room_id: closed }, propId)).reason).toBe(
      'That unit isn’t free for those nights — it is closed (maintenance or out of service).'
    );
  });

  it('tells the confirm box what has been paid, so it can say who will owe whom', async () => {
    const r = await unit('G');
    const id = await booking(r, 10, 12, 'CONFIRMED', 2 * NIGHTLY, 30_000);
    expect(await service.previewMove(id, { check_out_date: day(13) }, propId)).toMatchObject({
      allowed: true, paid_amount: 30_000, new_total: 3 * NIGHTLY,
    });
  });

  it('flags a fully refunded stay on the calendar — and not a complimentary one', async () => {
    const r = await unit('H');
    const refunded = await booking(r, 10, 12, 'CONFIRMED', 0, 2 * NIGHTLY);
    const receipt = await db.selectFrom('invoices').select('id').where('reservation_id', '=', refunded).executeTakeFirstOrThrow();
    await db.updateTable('invoices').set({ status: 'REFUNDED' }).where('id', '=', receipt.id).execute();
    await db.insertInto('invoices').values({
      number: `INV-E11-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, reservation_id: refunded, kind: 'REFUND',
      subtotal_amount: 2 * NIGHTLY, tax_rate_bps: 0, tax_amount: 0, total_amount: 2 * NIGHTLY, status: 'PAID',
      refund_of_invoice_id: receipt.id, issued_by: userId, created_by: userId, updated_by: userId,
    }).execute();
    const comp = await booking(await unit('H2'), 10, 12, 'CONFIRMED', 0);

    const view = await service.getCalendar({ from: day(9), days: 7 }, propId);
    const bar = (id: string) => view.bookings.find((b) => b.id === id)!;
    expect(bar(refunded)).toMatchObject({ fully_refunded: true, payment_incomplete: false });
    expect(bar(comp)).toMatchObject({ fully_refunded: false, payment_incomplete: false });
  });
});

