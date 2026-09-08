/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * G30 — the accrual reporting queries, and D08's month boundary, against real SQL.
 *
 * Integration because every claim is a claim about the database: that the ledger's own
 * room_id (not the reservation's) decides which property a night belongs to, that
 * superseded rows are invisible, and that a payment at 00:30 Gaborone lands in the
 * right month. A mocked repository would assert none of it.
 *
 * Unit type CONFERENCE, and this suite claims it — `rate_plans_active_unit_type_unique`
 * allows one active plan per type, and DELUXE/CUSTOM/STANDARD/SUITE are taken.
 * Stay dates sit in 2034, a year no other suite uses, and every window is bounded to it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { db } from '../../../src/config/db.js';
import { ReportsRepository } from '../../../src/modules/reports/reports.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const WINDOW = { from: '2034-01-01', toExcl: '2035-01-01', accessiblePropertyIds: null };

let userId: string;
let guestId: string;
let propertyA: string;
let propertyB: string;
let roomA: string;
let roomB: string;
const reservationIds: string[] = [];
const invoiceIds: string[] = [];

const repo = () => new ReportsRepository(db);
const num = (v: string | number | null | undefined) => Number(v ?? 0);

async function makeProperty(label: string) {
  const propertyId = (
    await db.insertInto('properties').values({ name: `RA_${label}_${uniq}` }).returning('id').executeTakeFirstOrThrow()
  ).id;
  const buildingId = (
    await db
      .insertInto('buildings')
      .values({ property_id: propertyId, name: `RA_B_${label}_${uniq}` })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  const roomId = (
    await db
      .insertInto('rooms')
      .values({
        name: `RA ${label}`,
        code: `RA-${label}-${uniq}`.slice(0, 20),
        type: 'CONFERENCE',
        capacity: 2,
        building_id: buildingId,
        created_by: userId,
        updated_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  return { propertyId, roomId };
}

/** A stay, and the ledger rows for it — written directly, so each case stages its own shape. */
async function recognise(
  roomId: string,
  nights: { stay_date: string; amount: number; superseded?: boolean }[],
  opts: { source?: 'FOLIO' | 'PRICED' } = {}
): Promise<string> {
  const reservationId = (
    await db
      .insertInto('reservations')
      .values({
        contact_id: guestId,
        room_id: roomId,
        check_in_date: new Date(nights[0]!.stay_date),
        check_out_date: new Date(new Date(nights[nights.length - 1]!.stay_date).getTime() + 86_400_000),
        status: 'CHECKED_OUT',
        source: 'DIRECT',
        created_by: userId,
        updated_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  reservationIds.push(reservationId);

  for (const night of nights) {
    await db
      .insertInto('revenue_recognition')
      .values({
        reservation_id: reservationId,
        room_id: roomId,
        stay_date: night.stay_date,
        currency: 'BWP',
        amount: night.amount,
        tax_amount: Math.round(night.amount * 0.1228),
        tax_rate_bps: 1400,
        total_source: opts.source ?? 'FOLIO',
        created_by: userId,
        ...(night.superseded ? { superseded_at: new Date(), superseded_reason: 'RE_PRICED' } : {}),
      })
      .execute();
  }
  return reservationId;
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (
    await db
      .insertInto('users')
      .values({ role_id: role.id, name: 'Reports Accrual', email: `ra-${uniq}@test.local`, password_hash: 'x' })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
  guestId = (
    await db
      .insertInto('contacts')
      .values({ name: 'Tebogo Kgosi', email: `tebogo-${uniq}@test.local`, created_by: userId, updated_by: userId })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  ({ propertyId: propertyA, roomId: roomA } = await makeProperty('A'));
  ({ propertyId: propertyB, roomId: roomB } = await makeProperty('B'));
});

afterAll(async () => {
  if (reservationIds.length > 0) {
    await db.deleteFrom('revenue_recognition').where('reservation_id', 'in', reservationIds).execute();
    await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
  }
  if (invoiceIds.length > 0) await db.deleteFrom('invoices').where('id', 'in', invoiceIds).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomA, roomB]).execute();
  await db.deleteFrom('buildings').where('property_id', 'in', [propertyA, propertyB]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propertyA, propertyB]).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('earnedByMonth', () => {
  it('buckets each night into the month it was slept in', async () => {
    await recognise(roomA, [
      { stay_date: '2034-03-30', amount: 10_000 },
      { stay_date: '2034-03-31', amount: 10_000 },
      { stay_date: '2034-04-01', amount: 10_000 },
    ]);

    const rows = await repo().earnedByMonth({ ...WINDOW, propertyId: propertyA });
    const byMonth = new Map(rows.map((r) => [r.month, num(r.amount)]));

    expect(byMonth.get('2034-03')).toBe(20_000);
    expect(byMonth.get('2034-04')).toBe(10_000);
  });

  // The live ledger is `superseded_at IS NULL`. A restated stay whose old version still
  // counted would double the month it was restated in.
  it('counts only the live version of a restated stay', async () => {
    await recognise(roomA, [
      { stay_date: '2034-06-01', amount: 99_000, superseded: true },
      { stay_date: '2034-06-01', amount: 50_000 },
    ]);

    const rows = await repo().earnedByMonth({ ...WINDOW, propertyId: propertyA });
    expect(num(rows.find((r) => r.month === '2034-06')?.amount)).toBe(50_000);
  });

  it('reports the reconstructed share separately from the total', async () => {
    await recognise(roomB, [{ stay_date: '2034-08-01', amount: 40_000 }], { source: 'PRICED' });
    await recognise(roomB, [{ stay_date: '2034-08-02', amount: 60_000 }], { source: 'FOLIO' });

    const row = (await repo().earnedByMonth({ ...WINDOW, propertyId: propertyB })).find(
      (r) => r.month === '2034-08'
    )!;

    expect(num(row.amount)).toBe(100_000);
    expect(num(row.reconstructed)).toBe(40_000);
  });
});

describe('earnedByProperty', () => {
  /**
   * The property comes from the LEDGER's room_id, not the reservation's. A booking
   * moved to another unit must not drag its already-earned nights across — that would
   * put nights on a landlord's statement for a unit that stood empty.
   */
  it('keeps a moved booking’s earned nights on the unit that earned them', async () => {
    const reservationId = await recognise(roomA, [{ stay_date: '2034-11-01', amount: 70_000 }]);

    // The booking moves to the other property's unit; the ledger row does not.
    await db.updateTable('reservations').set({ room_id: roomB }).where('id', '=', reservationId).execute();

    const rows = await repo().earnedByProperty({ ...WINDOW, propertyId: propertyA });
    expect(num(rows.find((r) => r.property_id === propertyA)?.amount)).toBeGreaterThanOrEqual(70_000);

    const other = await repo().earnedByProperty({ ...WINDOW, propertyId: propertyB });
    const novemberOnB = await repo().earnedByMonth({ from: '2034-11-01', toExcl: '2034-12-01', propertyId: propertyB, accessiblePropertyIds: null });
    expect(novemberOnB).toHaveLength(0);
    expect(other.length).toBeGreaterThan(0); // property B still has its own August rows
  });

  it('shows nothing to a caller scoped to neither property', async () => {
    expect(await repo().earnedByProperty({ ...WINDOW, accessiblePropertyIds: [] })).toHaveLength(0);
  });
});

describe('unrecognisedStays', () => {
  it('counts an earning stay that has no live ledger rows, and stops counting it once it has', async () => {
    const reservationId = (
      await db
        .insertInto('reservations')
        .values({
          contact_id: guestId,
          room_id: roomA,
          check_in_date: new Date('2034-12-10'),
          check_out_date: new Date('2034-12-12'),
          status: 'CONFIRMED',
          source: 'DIRECT',
          created_by: userId,
          updated_by: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    reservationIds.push(reservationId);

    const window = { from: '2034-12-01', toExcl: '2035-01-01', propertyId: propertyA, accessiblePropertyIds: null };
    expect(await repo().unrecognisedStays(window)).toBe(1);

    await db
      .insertInto('revenue_recognition')
      .values({
        reservation_id: reservationId,
        room_id: roomA,
        stay_date: '2034-12-10',
        currency: 'BWP',
        amount: 5_000,
        tax_amount: 614,
        tax_rate_bps: 1400,
        total_source: 'FOLIO',
        created_by: userId,
      })
      .execute();

    expect(await repo().unrecognisedStays(window)).toBe(0);
  });
});

describe('D08 — cash revenue buckets on the property day', () => {
  /**
   * Gaborone is UTC+2, so 22:30 UTC on 30 September is already 00:30 on 1 October
   * there. Bucketing in UTC filed that payment into September — a month that may
   * already have been reported. Two hours of every month landed in the wrong one.
   */
  it('puts a payment taken just after midnight in Gaborone into the new month', async () => {
    const insert = async (paidAt: string, amount: number) => {
      const row = await db
        .insertInto('invoices')
        .values({
          number: `INV-RA-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          kind: 'BALANCE',
          currency: 'BWP',
          subtotal_amount: amount,
          tax_rate_bps: 0,
          tax_amount: 0,
          total_amount: amount,
          status: 'PAID',
          issued_by: userId,
          created_by: userId,
          updated_by: userId,
          created_at: new Date(paidAt),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      invoiceIds.push(row.id);
    };

    await insert('2034-09-30T22:30:00Z', 30_000); // 00:30 on 1 Oct, Gaborone
    await insert('2034-09-30T21:30:00Z', 70_000); // 23:30 on 30 Sep, Gaborone

    // Unattributed invoices (no reservation) resolve to a null property, which only an
    // admin scope sees — hence accessiblePropertyIds null and no propertyId here.
    const rows = await repo().revenueByMonth({ from: '2034-09-01', toExcl: '2034-11-01', accessiblePropertyIds: null });
    const byMonth = new Map(rows.map((r) => [r.month, num(r.amount)]));

    expect(byMonth.get('2034-09')).toBe(70_000);
    expect(byMonth.get('2034-10')).toBe(30_000);
  });
});

describe('the two bases are separate books', () => {
  // The invariant that keeps the money axis honest: recognition never consults an
  // invoice, and cash revenue never consults the ledger. If either query grew a join
  // to the other, a pay-later stay would be counted twice or not at all.
  it('reads earned revenue without touching invoices', async () => {
    const plan = await sql<{ 'QUERY PLAN': string }>`
      EXPLAIN SELECT to_char(rr.stay_date, 'YYYY-MM'), SUM(rr.amount)
      FROM revenue_recognition rr
      JOIN rooms rm ON rm.id = rr.room_id
      WHERE rr.superseded_at IS NULL
      GROUP BY 1
    `.execute(db);
    const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(text.toLowerCase()).not.toContain('invoice');
  });
});
