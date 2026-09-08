/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * G30 — the accrual revenue ledger (migration 069), against real SQL.
 *
 * Integration rather than unit because the claims worth making are claims about the
 * database: that one night can never have two live rows, that superseding and
 * inserting happen in an order the unique index tolerates, and that a re-priced stay
 * leaves its old version standing as history rather than being edited away.
 *
 * Unit type SUITE, and this suite claims it. `rate_plans_active_unit_type_unique` is
 * a partial unique index allowing only ONE active plan per unit type, so two suites
 * sharing a type collide the moment they run in the same pass — DELUXE belongs to
 * folio, CUSTOM to mark-paid, STANDARD to everyone else.
 *
 * Stay dates sit in 2035 and every reconcile() is windowed to that year. The sweep is
 * house-wide by design (it has to be — a booking it skips is a month that
 * under-reports), so an unwindowed call here would recognise every other suite's
 * fixtures too.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { RevenueRepository } from '../../../src/modules/revenue/revenue.repository.js';
import { RevenueService } from '../../../src/modules/revenue/revenue.service.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const NIGHTLY = 150_000; // P1,500.00 a night, in thebe
const WINDOW = { from: '2035-01-01', toExcl: '2036-01-01' };

let userId: string;
let propertyId: string;
let buildingId: string;
let ratePlanId: string;
let guestId: string;

const reservationIds: string[] = [];
const roomIds: string[] = [];

const service = () => new RevenueService(new RevenueRepository(db));
const repository = () => new RevenueRepository(db);

/** A booking on its own unit, so no two fixtures collide on reservations_no_overlap. */
async function makeBooking(
  label: string,
  fields: {
    checkIn: string;
    checkOut: string;
    total: number | null;
    status?: 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
  }
): Promise<{ reservationId: string; roomId: string }> {
  const roomId = (
    await db
      .insertInto('rooms')
      .values({
        name: `Revenue ${label}`,
        code: `RV-${label}-${uniq}`.slice(0, 20),
        type: 'SUITE',
        capacity: 4,
        building_id: buildingId,
        created_by: userId,
        updated_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  roomIds.push(roomId);

  const reservationId = (
    await db
      .insertInto('reservations')
      .values({
        contact_id: guestId,
        room_id: roomId,
        check_in_date: new Date(fields.checkIn),
        check_out_date: new Date(fields.checkOut),
        status: fields.status ?? 'CONFIRMED',
        source: 'DIRECT',
        folio_total_amount: fields.total,
        created_by: userId,
        updated_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  reservationIds.push(reservationId);

  return { reservationId, roomId };
}

const sumAmount = (rows: { amount: number }[]) => rows.reduce((n, row) => n + row.amount, 0);

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (
    await db
      .insertInto('users')
      .values({ role_id: role.id, name: 'Revenue Test', email: `revenue-${uniq}@test.local`, password_hash: 'x' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  propertyId = (
    await db.insertInto('properties').values({ name: `RV_PROP_${uniq}` }).returning('id').executeTakeFirstOrThrow()
  ).id;
  buildingId = (
    await db
      .insertInto('buildings')
      .values({ property_id: propertyId, name: `RV_BLDG_${uniq}` })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  ratePlanId = (
    await db
      .insertInto('rate_plans')
      .values({
        unit_type: 'SUITE',
        name: `RV Rate ${uniq}`,
        nightly_rate: NIGHTLY,
        weekly_rate: NIGHTLY * 6,
        monthly_rate: NIGHTLY * 24,
        max_guests: 4,
        deposit_pct: 50,
        tax_rate_bps: 1400,
        created_by: userId,
        updated_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  guestId = (
    await db
      .insertInto('contacts')
      .values({ name: 'Naledi Molefe', email: `naledi-${uniq}@test.local`, created_by: userId, updated_by: userId })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
});

afterAll(async () => {
  if (reservationIds.length > 0) {
    await db.deleteFrom('revenue_recognition').where('reservation_id', 'in', reservationIds).execute();
    await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
  }
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('audit_logs').where('entity', '=', 'revenue_recognition').execute();
  await db.deleteFrom('rate_plans').where('id', '=', ratePlanId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  if (roomIds.length > 0) await db.deleteFrom('rooms').where('id', 'in', roomIds).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('recognising a stay', () => {
  it('writes one night per night, summing to the agreed total', async () => {
    const { reservationId } = await makeBooking('basic', {
      checkIn: '2035-03-01',
      checkOut: '2035-03-06', // 5 nights
      total: 750_000,
    });

    await service().reconcile(WINDOW);
    const nights = await repository().liveNights(reservationId);

    expect(nights).toHaveLength(5);
    expect(sumAmount(nights)).toBe(750_000);
    expect(nights.every((night) => night.total_source === 'FOLIO')).toBe(true);
    expect(nights.every((night) => night.version === 1)).toBe(true);
  });

  // Half-open, like every other range here (invariant 4): the guest checks out on the
  // 6th and the 6th earns nothing, which is what makes same-day checkout/checkin legal
  // without two bookings both earning that date.
  it('does not earn the check-out date', async () => {
    const { reservationId } = await makeBooking('halfopen', {
      checkIn: '2035-04-01',
      checkOut: '2035-04-03',
      total: 300_000,
    });

    await service().reconcile(WINDOW);
    const nights = await repository().liveNights(reservationId);

    expect(nights.map((night) => night.stay_date)).toEqual(['2035-04-01', '2035-04-02']);
  });

  /**
   * The trap this suite would otherwise pass by luck.
   *
   * node-postgres turns a `date` column into a JS Date at midnight in the NODE
   * PROCESS's zone. Run with TZ=Africa/Gaborone (UTC+2, the timezone of record) and
   * reading it back as ISO gives the PREVIOUS day — the ledger would recognise 31
   * January for a stay that began on 1 February, and the sweep would restate
   * everything every night because nothing ever compared equal. CI and the containers
   * run TZ=UTC, which hides it entirely, so these dates are chosen to sit either side
   * of a month end where the shift would be unmissable. The repository formats
   * stay_date in SQL to keep the driver out of it.
   */
  it('recognises the dates that were booked, whatever the session timezone', async () => {
    const { reservationId } = await makeBooking('tz', {
      checkIn: '2035-01-31',
      checkOut: '2035-02-03',
      total: 300_000,
    });

    await service().reconcile(WINDOW);
    const nights = await repository().liveNights(reservationId);

    expect(nights.map((night) => night.stay_date)).toEqual(['2035-01-31', '2035-02-01', '2035-02-02']);
  });

  /**
   * The reason the ledger exists at all. A stay straddling month end must put its
   * September nights in September, whenever the guest happens to pay — that was the
   * owner's driver for making LSP the book of record.
   */
  it('lands each night in the month that earned it', async () => {
    const { reservationId } = await makeBooking('boundary', {
      checkIn: '2035-09-28',
      checkOut: '2035-10-03', // 3 nights in September, 2 in October
      total: 500_000,
    });

    await service().reconcile(WINDOW);
    const nights = await repository().liveNights(reservationId);
    const september = nights.filter((night) => night.stay_date.startsWith('2035-09'));
    const october = nights.filter((night) => night.stay_date.startsWith('2035-10'));

    expect(september).toHaveLength(3);
    expect(october).toHaveLength(2);
    expect(sumAmount(september) + sumAmount(october)).toBe(500_000);
  });

  /**
   * The money axis and the lifecycle axis part company here (invariant 3). A PENDING
   * booking HOLDS the room (invariant 7) and counts as forward demand (D02) — but it
   * has earned nothing, and an abandoned one is auto-cancelled within the day.
   */
  it('earns nothing for a booking that only holds the room', async () => {
    const { reservationId } = await makeBooking('pending', {
      checkIn: '2035-05-01',
      checkOut: '2035-05-04',
      total: 450_000,
      status: 'PENDING',
    });

    await service().reconcile(WINDOW);

    expect(await repository().liveNights(reservationId)).toHaveLength(0);
  });
});

describe('reconciling twice', () => {
  /**
   * The property the nightly sweep rests on. Appending instead of reconciling would
   * double-count every night on the second run, and nobody reads a P&L closely enough
   * to catch that in the first month.
   */
  it('changes nothing when the ledger already agrees', async () => {
    const { reservationId } = await makeBooking('idempotent', {
      checkIn: '2035-06-01',
      checkOut: '2035-06-04',
      total: 450_000,
    });

    await service().reconcile(WINDOW);
    const first = await repository().liveNights(reservationId);

    const second = await service().reconcile(WINDOW);
    const after = await repository().liveNights(reservationId);

    // Same rows, not merely the same totals: identical ids means nothing was
    // rewritten, which is the claim.
    expect(after.map((night) => night.id)).toEqual(first.map((night) => night.id));
    expect(second.reservations_changed).toBe(0);
    expect(second.nights_written).toBe(0);
  });
});

describe('restating a stay', () => {
  it('supersedes the old version instead of editing it, and keeps exactly one live row a night', async () => {
    const { reservationId } = await makeBooking('reprice', {
      checkIn: '2035-07-01',
      checkOut: '2035-07-04',
      total: 450_000,
    });

    await service().reconcile(WINDOW);
    const before = await repository().liveNights(reservationId);

    await db
      .updateTable('reservations')
      .set({ folio_total_amount: 600_000 })
      .where('id', '=', reservationId)
      .execute();
    await service().reconcile(WINDOW);

    const live = await repository().liveNights(reservationId);
    expect(live).toHaveLength(3);
    expect(sumAmount(live)).toBe(600_000);
    expect(live.every((night) => night.version === 2)).toBe(true);

    // The old version is still there — history, not a correction that erased itself.
    const all = await db
      .selectFrom('revenue_recognition')
      .selectAll()
      .where('reservation_id', '=', reservationId)
      .execute();
    expect(all).toHaveLength(6);

    const superseded = all.filter((night) => night.superseded_at !== null);
    expect(superseded).toHaveLength(3);
    expect(superseded.every((night) => night.superseded_reason === 'RE_PRICED')).toBe(true);
    expect(superseded.every((night) => night.superseded_by !== null)).toBe(true);
    expect(sumAmount(superseded)).toBe(450_000);
    expect(before.map((night) => night.id).sort()).toEqual(superseded.map((night) => night.id).sort());
  });

  /**
   * A booking moved to another unit must not drag its already-earned nights with it.
   * The room that earned the night is a fact about the night — resolving it through
   * the reservation at read time would put nights on a landlord's statement for a
   * unit that was standing empty.
   */
  it('leaves superseded nights on the unit that actually earned them', async () => {
    const { reservationId } = await makeBooking('moved', {
      checkIn: '2035-08-01',
      checkOut: '2035-08-03',
      total: 300_000,
    });
    const { roomId: newRoomId } = await makeBooking('moved-target', {
      checkIn: '2035-11-01',
      checkOut: '2035-11-02',
      total: null,
      status: 'CANCELLED', // just a spare unit; it must not earn anything itself
    });

    await service().reconcile(WINDOW);
    const originalRoom = (await repository().liveNights(reservationId))[0]!.room_id;

    await db.updateTable('reservations').set({ room_id: newRoomId }).where('id', '=', reservationId).execute();
    await service().reconcile(WINDOW);

    const all = await db
      .selectFrom('revenue_recognition')
      .selectAll()
      .where('reservation_id', '=', reservationId)
      .execute();

    const superseded = all.filter((night) => night.superseded_at !== null);
    const live = all.filter((night) => night.superseded_at === null);

    expect(superseded.every((night) => night.room_id === originalRoom)).toBe(true);
    expect(superseded.every((night) => night.superseded_reason === 'ROOM_CHANGED')).toBe(true);
    expect(live.every((night) => night.room_id === newRoomId)).toBe(true);
  });

  it('supersedes with no replacement when a stay is cancelled', async () => {
    const { reservationId } = await makeBooking('cancelled', {
      checkIn: '2035-02-01',
      checkOut: '2035-02-05',
      total: 600_000,
    });

    await service().reconcile(WINDOW);
    expect(await repository().liveNights(reservationId)).toHaveLength(4);

    await db.updateTable('reservations').set({ status: 'CANCELLED' }).where('id', '=', reservationId).execute();
    await service().reconcile(WINDOW);

    expect(await repository().liveNights(reservationId)).toHaveLength(0);

    const all = await db
      .selectFrom('revenue_recognition')
      .selectAll()
      .where('reservation_id', '=', reservationId)
      .execute();
    // The nights are still on the record, marked as no longer earning, with nothing
    // to point forward to — the case the superseded-pair CHECK exists to allow.
    expect(all).toHaveLength(4);
    expect(all.every((night) => night.superseded_reason === 'NO_LONGER_EARNING')).toBe(true);
    expect(all.every((night) => night.superseded_by === null)).toBe(true);
  });
});

describe('a booking with no agreed total', () => {
  it('earns nothing, and is counted rather than swallowed', async () => {
    await makeBooking('unpriced', {
      checkIn: '2035-10-10',
      checkOut: '2035-10-13',
      total: null,
    });

    const result = await service().reconcile(WINDOW);

    expect(result.unpriced).toBeGreaterThanOrEqual(1);
  });

  /**
   * The dangerous case, and the reason "cannot price it" and "it earns nothing" must
   * stay different answers. Treating them as one would supersede a month of real
   * recognised nights the moment a pricer went missing — a wiring change quietly
   * erasing revenue that had already been reported.
   */
  it('keeps the nights it already earned rather than withdrawing them', async () => {
    const { reservationId } = await makeBooking('unpriced-existing', {
      checkIn: '2035-10-20',
      checkOut: '2035-10-23',
      total: 300_000,
    });

    await service().reconcile(WINDOW);
    const earned = await repository().liveNights(reservationId);
    expect(earned).toHaveLength(3);

    // The total goes away; the booking stays CONFIRMED and still earning.
    await db
      .updateTable('reservations')
      .set({ folio_total_amount: null })
      .where('id', '=', reservationId)
      .execute();
    await service().reconcile(WINDOW);

    const after = await repository().liveNights(reservationId);
    expect(after.map((night) => night.id)).toEqual(earned.map((night) => night.id));
  });
});

describe('the ledger defends itself', () => {
  it('refuses a second live row for a night the booking already earns', async () => {
    const { reservationId, roomId } = await makeBooking('double', {
      checkIn: '2035-12-01',
      checkOut: '2035-12-03',
      total: 300_000,
    });

    await service().reconcile(WINDOW);
    const night = (await repository().liveNights(reservationId))[0]!;

    // revenue_recognition_live_night. Without it a half-finished restatement would
    // double-count a night, and the P&L would be wrong in the direction nobody checks.
    await expect(
      db
        .insertInto('revenue_recognition')
        .values({
          reservation_id: reservationId,
          room_id: roomId,
          stay_date: night.stay_date,
          currency: 'BWP',
          amount: 1,
          tax_amount: 0,
          tax_rate_bps: 1400,
          total_source: 'FOLIO',
          created_by: userId,
        })
        .execute()
    ).rejects.toThrow(/revenue_recognition_live_night|duplicate key/i);
  });
});
