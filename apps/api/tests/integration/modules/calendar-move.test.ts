/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Calendar drag, 2026-10-06) GET /reservations/:id/move-preview — what dragging a booking on
 * the board would do, before anything is saved: the same refusals as an edit, and the same
 * price movement (an unpaid pending booking re-priced; anything else moved by the difference).
 * The last test makes the move for real and checks the edit lands on the previewed price.
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
    name: `Move ${code}`, code: `MV-${code}-${uniq}`, type: 'STANDARD', capacity: 2,
    building_id: other ? otherBldId : bldId, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  roomIds.push(id);
  return id;
}

async function booking(roomId: string, from: number, to: number, status: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'BLOCKED', folio: number | null, paid = 0) {
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, check_in_date: new Date(day(from)), check_out_date: new Date(day(to)),
    status, source: status === 'BLOCKED' ? 'BOOKING_COM' : 'DIRECT', folio_total_amount: folio,
    created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  reservationIds.push(id);
  if (paid > 0) {
    await db.insertInto('invoices').values({
      number: `INV-MV-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, reservation_id: id, kind: 'DEPOSIT',
      subtotal_amount: paid, tax_rate_bps: 0, tax_amount: 0, total_amount: paid, status: 'PAID',
      issued_by: userId, created_by: userId, updated_by: userId,
    }).execute();
  }
  return id;
}

beforeAll(async () => {
  releaseUnitType = await lockUnitType('STANDARD');
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'Move', email: `mv-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `MV_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  otherPropId = (await db.insertInto('properties').values({ name: `MV_O_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `MVB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  otherBldId = (await db.insertInto('buildings').values({ property_id: otherPropId, name: `MVO_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'STANDARD', name: `MV Rate ${uniq}`, nightly_rate: NIGHTLY, weekly_rate: NIGHTLY * 7, monthly_rate: NIGHTLY * 30,
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

describe('calendar drag — move preview', () => {
  it('re-prices an unpaid pending booking for its new stay', async () => {
    const r = await unit('A');
    const id = await booking(r, 10, 12, 'PENDING', 2 * NIGHTLY);
    const p = await service.previewMove(id, { check_out_date: day(13) }, propId);
    expect(p).toMatchObject({ allowed: true, current_total: 2 * NIGHTLY, new_total: 3 * NIGHTLY, total_source: 'FOLIO', opens_cleaning_task: false });
  });

  it('moves a confirmed booking’s agreed price by the difference, keeping a negotiated rate', async () => {
    const r = await unit('B');
    const id = await booking(r, 10, 12, 'CONFIRMED', 75_000, 20_000); // negotiated P750 for 2 nights
    const p = await service.previewMove(id, { check_out_date: day(13) }, propId);
    expect(p).toMatchObject({ allowed: true, current_total: 75_000, new_total: 75_000 + NIGHTLY });
    // Same nights, another unit of the same type: no price change.
    const other = await unit('B2');
    expect(await service.previewMove(id, { room_id: other }, propId)).toMatchObject({ allowed: true, new_total: 75_000 });
  });

  it('refuses a move onto another booking, a closed unit, or another property’s unit', async () => {
    const r = await unit('C');
    const id = await booking(r, 20, 22, 'CONFIRMED', 2 * NIGHTLY);
    const busy = await unit('C2');
    await booking(busy, 21, 23, 'PENDING', 2 * NIGHTLY);
    expect(await service.previewMove(id, { room_id: busy }, propId)).toMatchObject({ allowed: false, reason: expect.stringMatching(/isn’t free/) });
    const closed = await unit('C3');
    await db.updateTable('rooms').set({ status: 'OUT_OF_SERVICE' }).where('id', '=', closed).execute();
    expect((await service.previewMove(id, { room_id: closed }, propId)).allowed).toBe(false);
    const elsewhere = await unit('C4', true);
    expect(await service.previewMove(id, { room_id: elsewhere }, propId)).toMatchObject({ allowed: false, reason: 'That unit is not in this property.' });
    // Half-open: moving to start the morning the other guest leaves is fine.
    expect((await service.previewMove(id, { room_id: busy, check_in_date: day(23), check_out_date: day(25) }, propId)).allowed).toBe(true);
  });

  it('keeps an in-house guest’s arrival day, and says a unit move opens a cleaning job', async () => {
    const r = await unit('D');
    const id = await booking(r, -2, 3, 'CHECKED_IN', 5 * NIGHTLY, 5 * NIGHTLY);
    expect(await service.previewMove(id, { check_in_date: day(-1), check_out_date: day(4) }, propId)).toMatchObject({
      allowed: false, reason: expect.stringMatching(/already arrived/),
    });
    const to = await unit('D2');
    expect(await service.previewMove(id, { room_id: to }, propId)).toMatchObject({ allowed: true, opens_cleaning_task: true });
    expect(await service.previewMove(id, { check_out_date: day(4) }, propId)).toMatchObject({ allowed: true, new_total: 6 * NIGHTLY });
  });

  it('refuses Booking.com blocks, finished stays, empty stays and starts in the past', async () => {
    const r = await unit('E');
    const ota = await booking(r, 30, 32, 'BLOCKED', null);
    expect(await service.previewMove(ota, { check_in_date: day(31), check_out_date: day(33) }, propId)).toMatchObject({ allowed: false, reason: expect.stringMatching(/Booking\.com/) });
    const done = await booking(r, -10, -8, 'CHECKED_OUT', 2 * NIGHTLY);
    expect((await service.previewMove(done, { check_out_date: day(-7) }, propId)).allowed).toBe(false);
    const id = await booking(r, 40, 42, 'PENDING', 2 * NIGHTLY);
    expect(await service.previewMove(id, { check_in_date: day(42), check_out_date: day(42) }, propId)).toMatchObject({ allowed: false, reason: 'The stay must be at least one night.' });
    expect(await service.previewMove(id, { check_in_date: day(-1), check_out_date: day(1) }, propId)).toMatchObject({ allowed: false, reason: expect.stringMatching(/in the past/) });
    // Another property's caller can't even see it.
    await expect(service.previewMove(id, {}, otherPropId)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('writes nothing — and the real move lands on the previewed price', async () => {
    const r = await unit('F');
    const id = await booking(r, 50, 52, 'CONFIRMED', 90_000, 30_000);
    const p = await service.previewMove(id, { check_in_date: day(51), check_out_date: day(54) }, propId);
    const row = await db.selectFrom('reservations').select(['folio_total_amount', 'check_in_date']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.folio_total_amount).toBe(90_000);

    await service.modifyReservation(id, { check_in_date: new Date(day(51)), check_out_date: new Date(day(54)) }, meta(), propId);
    const after = await db.selectFrom('reservations').select('folio_total_amount').where('id', '=', id).executeTakeFirstOrThrow();
    expect(after.folio_total_amount).toBe(p.new_total);
    expect(p.new_total).toBe(90_000 + NIGHTLY);
  });
});
