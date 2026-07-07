/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the P4.4 customer-stats query that feeds segmentation: stays count only
 * confirmed/checked bookings, spend counts only PAID non-refund invoices, and
 * last_stay_days measures recency. The segmentation is company-wide (contacts are
 * not property-scoped), so assertions look up the self-created contacts by id
 * rather than trusting global aggregates (CI's lsp_test is seeded minimally).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { MarketingRepository } from '../../../src/modules/marketing/marketing.repository.js';

const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - n * 86_400_000);
};

let userId: string;
let propId: string;
let buildingId: string;
let roomId: string;
let contactA: string;   // 2 recent stays, one PAID invoice (plus ignored ones)
let contactB: string;   // 1 stay ~200 days ago, one PAID invoice
let contactC: string;   // no stays
const resIds: string[] = [];
const invIds: string[] = [];

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  const user = await db.insertInto('users')
    .values({ role_id: role.id, name: 'Mkt Test', email: `mkt-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow();
  userId = user.id;

  const prop = await db.insertInto('properties').values({ name: `MKT_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  propId = prop.id;
  const building = await db.insertInto('buildings').values({ property_id: propId, name: `MKT_B_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  buildingId = building.id;
  const room = await db.insertInto('rooms').values({ name: 'Mkt 1', code: `MKT-1-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow();
  roomId = room.id;

  const contacts = await db.insertInto('contacts')
    .values([
      { type: 'company', name: `A Kagiso ${uniq}`, created_by: userId, updated_by: userId },
      { type: 'individual', name: `B Lapsed ${uniq}`, created_by: userId, updated_by: userId },
      { type: 'individual', name: `C Prospect ${uniq}`, created_by: userId, updated_by: userId },
    ])
    .returning(['id', 'name']).execute();
  contactA = contacts.find((c) => c.name.startsWith('A '))!.id;
  contactB = contacts.find((c) => c.name.startsWith('B '))!.id;
  contactC = contacts.find((c) => c.name.startsWith('C '))!.id;

  const mkRes = async (contactId: string, checkOutDaysAgo: number) => {
    const r = await db.insertInto('reservations')
      .values({
        contact_id: contactId, room_id: roomId,
        check_in_date: daysAgo(checkOutDaysAgo + 2), check_out_date: daysAgo(checkOutDaysAgo),
        status: 'CHECKED_OUT', created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow();
    resIds.push(r.id);
    return r.id;
  };
  const a1 = await mkRes(contactA, 5);
  await mkRes(contactA, 18);           // A has 2 stays; most recent checkout 5 days ago
  const b1 = await mkRes(contactB, 200);

  const mkInv = async (reservationId: string, kind: 'DEPOSIT' | 'BALANCE' | 'REFUND', status: string, total: number) => {
    const i = await db.insertInto('invoices')
      .values({
        number: `MKT-${uniq}-${invIds.length}`, reservation_id: reservationId, kind: kind as 'BALANCE',
        status: status as 'PAID', subtotal_amount: total, tax_rate_bps: 0, tax_amount: 0, total_amount: total,
        issued_by: userId, created_by: userId, updated_by: userId,
      })
      .returning('id').executeTakeFirstOrThrow();
    invIds.push(i.id);
  };
  await mkInv(a1, 'BALANCE', 'PAID', 30_000);    // counts
  await mkInv(a1, 'BALANCE', 'ISSUED', 99_999);  // unpaid → ignored
  await mkInv(a1, 'REFUND', 'PAID', 5_000);      // refund → ignored
  await mkInv(b1, 'BALANCE', 'PAID', 15_000);    // counts
});

afterAll(async () => {
  await db.deleteFrom('invoices').where('id', 'in', invIds).execute();
  await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  await db.deleteFrom('contacts').where('id', 'in', [contactA, contactB, contactC]).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Marketing — customer stats (live DB)', () => {
  it('counts stays, sums only PAID non-refund spend, and measures recency', async () => {
    const rows = await new MarketingRepository(db).customerStats();
    const byId = new Map(rows.map((r) => [r.id, r]));

    const a = byId.get(contactA)!;
    expect(Number(a.stays)).toBe(2);
    expect(Number(a.spend)).toBe(30_000);           // ISSUED + REFUND excluded
    expect(Number(a.last_stay_days)).toBeGreaterThanOrEqual(4);
    expect(Number(a.last_stay_days)).toBeLessThan(30);

    const b = byId.get(contactB)!;
    expect(Number(b.stays)).toBe(1);
    expect(Number(b.spend)).toBe(15_000);
    expect(Number(b.last_stay_days)).toBeGreaterThan(190);

    const c = byId.get(contactC)!;
    expect(Number(c.stays)).toBe(0);
    expect(Number(c.spend)).toBe(0);
    expect(c.last_stay_days).toBeNull();
  });
});
