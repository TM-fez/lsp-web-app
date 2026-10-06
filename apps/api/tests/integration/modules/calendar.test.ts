/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Calendar, 2026-10-06) The front-desk board — Little Hotelier's calendar, rebuilt. One
 * property, one window of nights. What it must get right:
 *  - only this property's units, in door order (B1, B2, B10 — not B1, B10, B2);
 *  - every stay with a night on screen, including one that started before it; none that
 *    hold no nights (cancelled, no-show) and none from another property;
 *  - "incomplete payment" from the same paid-to-date the folio uses;
 *  - closures: a unit taken off sale, a dated repair, a bare hold — the same three things
 *    that make a booking attempt say no.
 * Dates far in the future (2037) so nothing else in the test DB lands in the window.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { CalendarQuerySchema } from '../../../src/modules/reservations/reservations.types.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';
import type { PricingService } from '../../../src/modules/pricing/pricing.service.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// A fixed rate card — P100 a night, no VAT — so the suite owns no shared active rate plan
// (one per unit type, and other suites claim them). Only for stays with no agreed total.
const NIGHT = 10_000;
const pricing = {
  getActivePlan: async () => ({ tax_rate_bps: 0, deposit_pct: 50 }),
  priceStay: (_plan: unknown, nights: number) => ({ currency: 'BWP', base_amount: nights * NIGHT }),
} as unknown as PricingService;
const service = new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db), pricing);
let userId: string, propId: string, otherPropId: string, bldId: string, otherBldId: string, planId: string;
let guestId: string, companyId: string;
const rooms: Record<string, string> = {};
const reservationIds: string[] = [];
const orderIds: string[] = [];
const quoteIds: string[] = [];
const holdIds: string[] = [];

async function room(code: string, opts: { status?: 'OUT_OF_SERVICE'; type?: 'SUITE'; other?: boolean } = {}) {
  const id = (await db.insertInto('rooms').values({
    name: `Cal ${code}`, code: `${code}-${uniq}`, type: opts.type ?? 'STANDARD', status: opts.status ?? 'AVAILABLE',
    capacity: 2, building_id: opts.other ? otherBldId : bldId, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  rooms[code] = id;
  return id;
}

async function booking(
  roomId: string,
  checkIn: string,
  checkOut: string,
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'BLOCKED',
  extra: { folio?: number | null; billing?: string; source?: 'BOOKING_COM' } = {}
) {
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, check_in_date: new Date(checkIn), check_out_date: new Date(checkOut),
    status, source: extra.source ?? 'DIRECT', folio_total_amount: extra.folio ?? null,
    billing_contact_id: extra.billing ?? null, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  reservationIds.push(id);
  return id;
}

async function paid(reservationId: string, total: number) {
  await db.insertInto('invoices').values({
    number: `INV-CAL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    reservation_id: reservationId, kind: 'DEPOSIT', subtotal_amount: total, tax_rate_bps: 0, tax_amount: 0,
    total_amount: total, status: 'PAID', issued_by: userId, created_by: userId, updated_by: userId,
  }).execute();
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'Cal', email: `cal-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `CAL_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  otherPropId = (await db.insertInto('properties').values({ name: `CAL_OTHER_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `CALB_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  otherBldId = (await db.insertInto('buildings').values({ property_id: otherPropId, name: `CALO_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'CUSTOM', name: `Cal plan ${uniq}`, nightly_rate: 1000, weekly_rate: 6000, monthly_rate: 24000, active: false,
    created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({
    name: 'Alexander Forbes', company: 'Access Bank', created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  companyId = (await db.insertInto('contacts').values({
    name: 'Financial Services Botswana', type: 'company', created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;

  await room('B10');
  await room('B2');
  await room('B1');
  await room('S1', { type: 'SUITE' });
  await room('B3', { status: 'OUT_OF_SERVICE' });
  await room('X1', { other: true });
});

afterAll(async () => {
  await db.deleteFrom('holds').where('id', 'in', holdIds.length ? holdIds : ['00000000-0000-0000-0000-000000000000']).execute();
  if (quoteIds.length) await db.deleteFrom('quotes').where('id', 'in', quoteIds).execute();
  await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
  if (orderIds.length) await db.deleteFrom('maintenance_work_orders').where('id', 'in', orderIds).execute();
  if (reservationIds.length) {
    await db.deleteFrom('invoices').where('reservation_id', 'in', reservationIds).execute();
    await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
  }
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('id', 'in', Object.values(rooms)).execute();
  await db.deleteFrom('contacts').where('id', 'in', [guestId, companyId]).execute();
  await db.deleteFrom('buildings').where('id', 'in', [bldId, otherBldId]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propId, otherPropId]).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

const window = (from = '2037-05-01', days = 14) => service.getCalendar(CalendarQuerySchema.parse({ from, days }), propId);

describe('front-desk calendar', () => {
  it('lists only this property’s units, grouped by type and in door order', async () => {
    const view = await window();
    expect(view.from).toBe('2037-05-01');
    expect(view.to).toBe('2037-05-15');
    expect(view.units.map((u) => u.code.replace(`-${uniq}`, ''))).toEqual(['B1', 'B2', 'B3', 'B10', 'S1']);
    expect(view.units.some((u) => u.id === rooms.X1)).toBe(false);
  });

  it('draws every stay with a night on screen — and nothing that holds no nights', async () => {
    const pending = await booking(rooms.B1, '2037-05-01', '2037-05-04', 'PENDING', { folio: 300_000 });
    const startedBefore = await booking(rooms.B2, '2037-04-28', '2037-05-02', 'CONFIRMED', { folio: 100_000, billing: companyId });
    await paid(startedBefore, 100_000);
    const cancelled = await booking(rooms.B10, '2037-05-03', '2037-05-05', 'CANCELLED');
    const ota = await booking(rooms.B10, '2037-05-06', '2037-05-08', 'BLOCKED', { source: 'BOOKING_COM' });
    const afterWindow = await booking(rooms.B1, '2037-05-15', '2037-05-17', 'PENDING');
    const endsAtStart = await booking(rooms.S1, '2037-04-29', '2037-05-01', 'CONFIRMED');
    const elsewhere = await booking(rooms.X1, '2037-05-02', '2037-05-03', 'PENDING');

    const view = await window();
    const ids = view.bookings.map((b) => b.id);
    expect(ids).toContain(pending);
    expect(ids).toContain(startedBefore);
    expect(ids).toContain(ota);
    // Half-open, like every stay: checking out on the first morning is not a night on screen,
    // and arriving on the morning after the last one is not either.
    for (const absent of [cancelled, afterWindow, endsAtStart, elsewhere]) expect(ids).not.toContain(absent);

    const b2 = view.bookings.find((b) => b.id === startedBefore)!;
    expect(b2).toMatchObject({
      check_in_date: '2037-04-28', check_out_date: '2037-05-02', status: 'CONFIRMED',
      guest_name: 'Alexander Forbes', company_name: 'Financial Services Botswana', payment_incomplete: false,
    });
    const b1 = view.bookings.find((b) => b.id === pending)!;
    // No separate payer: the company on the guest's own record, LH-style.
    expect(b1).toMatchObject({ company_name: 'Access Bank', payment_incomplete: true });
    // Booking.com collects for its own bookings; the desk is never owed on one.
    expect(view.bookings.find((b) => b.id === ota)!.payment_incomplete).toBe(false);
    expect(Object.keys(b1)).not.toContain('folio_total_amount');
  });

  it('marks a stay incomplete exactly when its folio would say unpaid or part-paid', async () => {
    const part = await booking(rooms.S1, '2037-05-08', '2037-05-10', 'CONFIRMED', { folio: 200_000 });
    await paid(part, 50_000);
    // No agreed total: priced at today's rates, like the folio does (2 nights = P200 here).
    const unpriced = await booking(rooms.S1, '2037-05-10', '2037-05-12', 'CONFIRMED');
    await paid(unpriced, 2 * NIGHT - 1);
    const unpricedPaid = await booking(rooms.S1, '2037-05-12', '2037-05-14', 'CONFIRMED');
    await paid(unpricedPaid, 2 * NIGHT);
    const comp = await booking(rooms.S1, '2037-05-14', '2037-05-15', 'CONFIRMED', { folio: 0 });

    const byId = new Map((await window()).bookings.map((b) => [b.id, b.payment_incomplete]));
    expect(byId.get(part)).toBe(true);
    expect(byId.get(unpriced)).toBe(true);
    expect(byId.get(unpricedPaid)).toBe(false);
    // A complimentary stay owes nothing (owner decision 2026-10-04 (d)).
    expect(byId.get(comp)).toBe(false);
  });

  it('shows the same closures that make a booking attempt say no', async () => {
    const live = (await db.insertInto('maintenance_work_orders').values({
      room_id: rooms.B10, title: 'Geyser burst', priority: 'CRITICAL', status: 'OPEN', reported_by: userId,
      blocks_from: '2037-05-10', blocks_to: '2037-05-12',
    } as never).returning('id').executeTakeFirstOrThrow()).id;
    const done = (await db.insertInto('maintenance_work_orders').values({
      room_id: rooms.B10, title: 'Old leak', priority: 'HIGH', status: 'COMPLETED', reported_by: userId,
      blocks_from: '2037-05-03', blocks_to: '2037-05-04',
    } as never).returning('id').executeTakeFirstOrThrow()).id;
    orderIds.push(live, done);

    const quote = async (ci: string, co: string) => {
      const id = (await db.insertInto('quotes').values({
        rate_plan_id: planId, unit_type: 'CUSTOM', check_in_date: new Date(ci), check_out_date: new Date(co),
        nights: 1, base_amount: 1000, tax_rate_bps: 0, tax_amount: 0, deposit_amount: 500, total_amount: 1000,
        expires_at: sql`now() + interval '1 day'`, created_by: userId,
      } as never).returning('id').executeTakeFirstOrThrow()).id;
      quoteIds.push(id);
      return id;
    };
    const hold = async (ci: string, co: string, until: 'future' | 'past') => {
      const id = (await db.insertInto('holds').values({
        quote_id: await quote(ci, co), room_id: rooms.B2, status: 'HELD',
        held_until: until === 'future' ? sql`now() + interval '20 minutes'` : sql`now() - interval '1 hour'`,
        created_by: userId, updated_by: userId,
      } as never).returning('id').executeTakeFirstOrThrow()).id;
      holdIds.push(id);
    };
    await hold('2037-05-05', '2037-05-07', 'future');
    await hold('2037-05-08', '2037-05-09', 'past'); // lapsed — holds nothing

    const { closures } = await window();
    const mine = closures.map(({ room_id, kind, from, to }) => ({ room: Object.keys(rooms).find((k) => rooms[k] === room_id), kind, from, to }));
    expect(mine).toEqual(expect.arrayContaining([
      { room: 'B3', kind: 'OUT_OF_SERVICE', from: null, to: null },
      { room: 'B10', kind: 'REPAIR', from: '2037-05-10', to: '2037-05-12' },
      { room: 'B2', kind: 'HOLD', from: '2037-05-05', to: '2037-05-07' },
    ]));
    expect(mine).toHaveLength(3);
    expect(closures.find((c) => c.kind === 'REPAIR')).toMatchObject({ label: 'Closed — Geyser burst', ref_id: live });
  });

  it('defaults to today in Gaborone and refuses a date that does not exist', () => {
    expect(CalendarQuerySchema.safeParse({ from: '2037-02-30' }).success).toBe(false);
    expect(CalendarQuerySchema.safeParse({ from: '2037-05-01', days: '0' }).success).toBe(false);
    expect(CalendarQuerySchema.safeParse({ from: '2037-05-01', days: '32' }).success).toBe(false);
    expect(CalendarQuerySchema.parse({}).days).toBe(28);
  });
});
