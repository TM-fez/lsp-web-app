/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Round 12, v1 launch fixes) N12-1: a guest checked in a day early is in the unit tonight, so
 * the booking's arrival moves to tonight — staff and the public page can no longer sell it, and
 * the revenue ledger still adds up to the folio. N12-2: PATCH can't cancel (or otherwise
 * re-status) an in-house stay behind the cancel route's back.
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
import { CheckinsService } from '../../../src/modules/checkins/checkins.service.js';
import { CheckinsRepository } from '../../../src/modules/checkins/checkins.repository.js';
import { PublicService } from '../../../src/modules/public/public.service.js';
import { PublicRepository } from '../../../src/modules/public/public.repository.js';
import { ContactsRepository } from '../../../src/modules/crm/contacts/contacts.repository.js';
import { LeadsRepository } from '../../../src/modules/crm/leads/leads.repository.js';
import { RevenueService } from '../../../src/modules/revenue/revenue.service.js';
import { RevenueRepository } from '../../../src/modules/revenue/revenue.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const NIGHTLY = 50_000; // P500 a night, zero-rated so totals are plain multiples
const meta = () => ({ userId, ip: '127.0.0.1', requestId: randomUUID() }) as never;
const service = new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db), new PricingService(new PricingRepository(db)));
const checkins = new CheckinsService(new CheckinsRepository(db), service);
const revenue = new RevenueService(new RevenueRepository(db));

let releaseUnitType: () => Promise<void>;
let userId: string, propId: string, otherPropId: string, bldId: string, otherBldId: string, planId: string, guestId: string;
const roomIds: string[] = [];
const reservationIds: string[] = [];
const publicContactIds: string[] = [];

const day = (offset: number) => {
  const d = new Date(`${todayInPropertyTZ()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function unit(code: string, other = false) {
  const id = (await db.insertInto('rooms').values({
    name: `Move ${code}`, code: `R12-${code}-${uniq}`, type: 'STANDARD', capacity: 2,
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
      number: `INV-R12-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, reservation_id: id, kind: 'DEPOSIT',
      subtotal_amount: paid, tax_rate_bps: 0, tax_amount: 0, total_amount: paid, status: 'PAID',
      issued_by: userId, created_by: userId, updated_by: userId,
    }).execute();
  }
  return id;
}

beforeAll(async () => {
  releaseUnitType = await lockUnitType('STANDARD');
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'Move', email: `r12-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `R12_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  otherPropId = (await db.insertInto('properties').values({ name: `R12_O_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `MVB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  otherBldId = (await db.insertInto('buildings').values({ property_id: otherPropId, name: `MVO_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'STANDARD', name: `R12 Rate ${uniq}`, nightly_rate: NIGHTLY, weekly_rate: NIGHTLY * 7, monthly_rate: NIGHTLY * 30,
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
    if (publicContactIds.length) await db.deleteFrom('contacts').where('id', 'in', publicContactIds).execute();
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
const arrival = async (id: string) =>
  (await db.selectFrom('reservations').select('check_in_date').where('id', '=', id).executeTakeFirstOrThrow()).check_in_date.toISOString().slice(0, 10);

/** The public /stay page, offering only this file's units (other suites make STANDARD units too). */
function publicPage(onlyRoom: string) {
  const repo = new PublicRepository(db);
  repo.bookableRoomsByType = async (t) =>
    (await PublicRepository.prototype.bookableRoomsByType.call(repo, t)).filter((r) => r.id === onlyRoom);
  return new PublicService(repo, service, new ContactsRepository(db), new LeadsRepository(db));
}

describe('early check-in holds tonight (N12-1)', () => {
  it('moves the arrival to tonight, so neither staff nor the public page can sell it — and the ledger matches the folio', async () => {
    const r = await unit('A');
    const id = await booking(r, 1, 3, 'CONFIRMED', 2 * NIGHTLY, 2 * NIGHTLY);
    await checkins.checkIn({ reservation_id: id, guest_count: 1 }, meta());

    expect(await arrival(id)).toBe(day(0));
    // The extra night is priced like any date edit on a confirmed stay: moved by the difference.
    const folio = await service.getFolio(id);
    expect(folio.total_amount).toBe(3 * NIGHTLY);

    expect(await status(service.createReservation(
      { contact_id: guestId, room_id: r, check_in_date: day(0), check_out_date: day(1), source: 'WALK_IN' } as never, meta(), propId,
    ))).toBe(409);
    const pub = publicPage(r);
    const attempt = pub.createBooking(
      { unit_type: 'STANDARD', check_in: new Date(day(0)), check_out: new Date(day(1)), guests: 1,
        name: 'Tonight Guest', email: `tonight-${uniq}@public.local`, phone: '+26771999999' } as never,
      { ip: '127.0.0.1', requestId: null } as never,
    );
    expect(await status(attempt)).toBe(409);
    const stray = await db.selectFrom('contacts').select('id').where('email', '=', `tonight-${uniq}@public.local`).execute();
    publicContactIds.push(...stray.map((c) => c.id));

    await revenue.reconcileFor([id]);
    const nights = await db.selectFrom('revenue_recognition').select(['stay_date', 'amount', 'tax_amount'])
      .where('reservation_id', '=', id).where('superseded_at', 'is', null).orderBy('stay_date').execute();
    expect(nights.map((n) => new Date(n.stay_date).toISOString().slice(0, 10))).toEqual([day(0), day(1), day(2)]);
    expect(nights.reduce((s, n) => s + Number(n.amount) + Number(n.tax_amount), 0)).toBe(folio.total_amount);
  });

  it('refuses an early check-in when another booking holds tonight, changing nothing', async () => {
    const r = await unit('B');
    await booking(r, 0, 1, 'PENDING', NIGHTLY);
    const id = await booking(r, 1, 3, 'CONFIRMED', 2 * NIGHTLY);
    expect(await status(checkins.checkIn({ reservation_id: id, guest_count: 1 }, meta()))).toBe(409);
    expect(await arrival(id)).toBe(day(1));
    const row = await db.selectFrom('reservations').select(['status', 'folio_total_amount']).where('id', '=', id).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'CONFIRMED', folio_total_amount: 2 * NIGHTLY });
  });

  it('leaves an on-the-day check-in’s dates and price alone', async () => {
    const r = await unit('C');
    const id = await booking(r, 0, 2, 'CONFIRMED', 2 * NIGHTLY);
    await checkins.checkIn({ reservation_id: id, guest_count: 1 }, meta());
    expect(await arrival(id)).toBe(day(0));
    expect((await service.getFolio(id)).total_amount).toBe(2 * NIGHTLY);
  });
});

describe('PATCH can’t re-status behind the cancel route (N12-2)', () => {
  it('refuses to cancel a checked-in stay with the cancel route’s 409, and tonight stays taken', async () => {
    const r = await unit('D');
    const id = await booking(r, 0, 2, 'CHECKED_IN', 2 * NIGHTLY);
    const viaPatch = await service.modifyReservation(id, { status: 'CANCELLED' }, meta(), propId).catch((e) => e);
    const viaRoute = await service.cancelReservation(id, meta(), propId).catch((e) => e);
    expect(viaPatch.statusCode).toBe(409);
    expect(viaPatch.message).toBe(viaRoute.message);
    const row = await db.selectFrom('reservations').select('status').where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('CHECKED_IN');
    expect(await status(service.createReservation(
      { contact_id: guestId, room_id: r, check_in_date: day(0), check_out_date: day(1), source: 'WALK_IN' } as never, meta(), propId,
    ))).toBe(409);
  });

  it('refuses the other hand-made status jumps, and still lets a live booking be cancelled', async () => {
    const r = await unit('E');
    const out = await booking(r, -3, -1, 'CHECKED_OUT', 2 * NIGHTLY);
    expect(await status(service.modifyReservation(out, { status: 'CANCELLED' }, meta(), propId))).toBe(409);
    expect(await status(service.modifyReservation(out, { status: 'PENDING' }, meta(), propId))).toBe(409);
    const confirmed = await booking(r, 5, 7, 'CONFIRMED', 2 * NIGHTLY);
    expect(await status(service.modifyReservation(confirmed, { status: 'PENDING' }, meta(), propId))).toBe(409);
    const inHouse = await booking(await unit('E2'), 0, 2, 'CHECKED_IN', 2 * NIGHTLY);
    expect(await status(service.modifyReservation(inHouse, { status: 'PENDING' }, meta(), propId))).toBe(409);

    await service.modifyReservation(confirmed, { status: 'CANCELLED' }, meta(), propId);
    const row = await db.selectFrom('reservations').select('status').where('id', '=', confirmed).executeTakeFirstOrThrow();
    expect(row.status).toBe('CANCELLED');
  });
});
