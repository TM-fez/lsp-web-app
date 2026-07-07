/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the P4.2 Financial Cockpit receivables ledger: open invoices roll up into
 * totals, ageing buckets, per-property debt, and the oldest-first drill-down — and
 * that PAID/settled invoices and REFUND liabilities are handled correctly.
 *
 * Fixtures are self-created and every assertion runs the service SCOPED to those
 * property ids, so unrelated rows in lsp_test never pollute the aggregates
 * (CI's lsp_test is seeded minimally; global/admin scope would be non-deterministic).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { FinanceRepository } from '../../../src/modules/finance/finance.repository.js';
import { FinanceService } from '../../../src/modules/finance/finance.service.js';

const service = new FinanceService(new FinanceRepository(db));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

let userId: string;
let propA: string;
let propB: string;
let buildingA: string;
let buildingB: string;
let roomA: string;
let roomB: string;
let guestId: string;
let billingId: string;
let resA: string;
let resB: string;
const invoiceIds: string[] = [];

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();

  const user = await db.insertInto('users')
    .values({ role_id: role.id, name: 'Finance Test', email: `finance-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow();
  userId = user.id;

  const props = await db.insertInto('properties')
    .values([{ name: `FIN_TEST_A_${uniq}` }, { name: `FIN_TEST_B_${uniq}` }])
    .returning(['id', 'name']).execute();
  propA = props.find((p) => p.name.includes('_A_'))!.id;
  propB = props.find((p) => p.name.includes('_B_'))!.id;

  const buildings = await db.insertInto('buildings')
    .values([{ property_id: propA, name: `FIN_BLDG_A_${uniq}` }, { property_id: propB, name: `FIN_BLDG_B_${uniq}` }])
    .returning(['id', 'property_id']).execute();
  buildingA = buildings.find((b) => b.property_id === propA)!.id;
  buildingB = buildings.find((b) => b.property_id === propB)!.id;

  const rooms = await db.insertInto('rooms')
    .values([
      { name: 'Unit A', code: `FIN-A-${uniq}`, building_id: buildingA, created_by: userId, updated_by: userId },
      { name: 'Unit B', code: `FIN-B-${uniq}`, building_id: buildingB, created_by: userId, updated_by: userId },
    ])
    .returning(['id', 'building_id']).execute();
  roomA = rooms.find((r) => r.building_id === buildingA)!.id;
  roomB = rooms.find((r) => r.building_id === buildingB)!.id;

  const contacts = await db.insertInto('contacts')
    .values([
      { type: 'individual', name: 'Neo Guest', email: 'neo@test.local', created_by: userId, updated_by: userId },
      { type: 'company', name: 'Acme Accounts', email: 'ap@acme.local', created_by: userId, updated_by: userId },
    ])
    .returning(['id', 'name']).execute();
  guestId = contacts.find((c) => c.name === 'Neo Guest')!.id;
  billingId = contacts.find((c) => c.name === 'Acme Accounts')!.id;

  // Reservation A carries a billing contact (invoices bill to it); B does not.
  const reservations = await db.insertInto('reservations')
    .values([
      { contact_id: guestId, room_id: roomA, billing_contact_id: billingId, check_in_date: daysAgo(50), check_out_date: daysAgo(48), status: 'CHECKED_OUT', created_by: userId, updated_by: userId },
      { contact_id: guestId, room_id: roomB, check_in_date: daysAgo(110), check_out_date: daysAgo(108), status: 'CHECKED_OUT', created_by: userId, updated_by: userId },
    ])
    .returning(['id', 'room_id']).execute();
  resA = reservations.find((r) => r.room_id === roomA)!.id;
  resB = reservations.find((r) => r.room_id === roomB)!.id;

  const inv = (over: Record<string, unknown>) => ({
    number: `FIN-${uniq}-${invoiceIds.length + Math.random().toString(36).slice(2, 6)}`,
    subtotal_amount: 0, tax_rate_bps: 0, tax_amount: 0, total_amount: 0,
    issued_by: userId, created_by: userId, updated_by: userId, ...over,
  });

  const invoices = await db.insertInto('invoices')
    .values([
      // propA — two open receivables in different age buckets
      inv({ reservation_id: resA, kind: 'BALANCE', status: 'ISSUED', total_amount: 100_000, created_at: daysAgo(10) }),  // 0-30
      inv({ reservation_id: resA, kind: 'DEPOSIT', status: 'ISSUED', total_amount: 50_000, created_at: daysAgo(45) }),   // 31-60
      // propA — settled: must NOT count as receivable
      inv({ reservation_id: resA, kind: 'BALANCE', status: 'PAID', total_amount: 999_999, created_at: daysAgo(5) }),
      // propA — refund liability: money we owe the guest, not a receivable
      inv({ reservation_id: resA, kind: 'REFUND', status: 'ISSUED', total_amount: 20_000, created_at: daysAgo(3) }),
      // propB — one very old open receivable (90+ bucket), bills to the guest
      inv({ reservation_id: resB, kind: 'BALANCE', status: 'ISSUED', total_amount: 200_000, created_at: daysAgo(100) }),
    ])
    .returning('id').execute();
  invoiceIds.push(...invoices.map((r) => r.id));
});

afterAll(async () => {
  await db.deleteFrom('invoices').where('id', 'in', invoiceIds).execute();
  await db.deleteFrom('reservations').where('id', 'in', [resA, resB]).execute();
  await db.deleteFrom('contacts').where('id', 'in', [guestId, billingId]).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomA, roomB]).execute();
  await db.deleteFrom('buildings').where('id', 'in', [buildingA, buildingB]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propA, propB]).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Financial Cockpit — receivables (live DB)', () => {
  it('rolls open DEPOSIT/BALANCE into totals, excluding settled invoices', async () => {
    const c = await service.getCockpit({ accessiblePropertyIds: [propA, propB] });
    expect(c.summary.total_receivable).toBe(350_000); // 100k + 50k + 200k (PAID 999k excluded)
    expect(c.summary.open_invoices).toBe(3);
    expect(c.summary.oldest_days).toBeGreaterThanOrEqual(99);
  });

  it('reports REFUND invoices as a separate payable, not a receivable', async () => {
    const c = await service.getCockpit({ accessiblePropertyIds: [propA, propB] });
    expect(c.summary.refunds_payable).toBe(20_000);
  });

  it('buckets receivables by issue age, always returning the four buckets in order', async () => {
    const c = await service.getCockpit({ accessiblePropertyIds: [propA, propB] });
    expect(c.aging.map((b) => b.bucket)).toEqual(['0-30', '31-60', '61-90', '90+']);
    const by = Object.fromEntries(c.aging.map((b) => [b.bucket, b]));
    expect(by['0-30']).toMatchObject({ amount: 100_000, count: 1 });
    expect(by['31-60']).toMatchObject({ amount: 50_000, count: 1 });
    expect(by['61-90']).toMatchObject({ amount: 0, count: 0 });
    expect(by['90+']).toMatchObject({ amount: 200_000, count: 1 });
  });

  it('attributes outstanding debt to each property, biggest first', async () => {
    const c = await service.getCockpit({ accessiblePropertyIds: [propA, propB] });
    const a = c.by_property.find((p) => p.property_id === propA)!;
    const b = c.by_property.find((p) => p.property_id === propB)!;
    expect(a).toMatchObject({ amount: 150_000, count: 2 });
    expect(b).toMatchObject({ amount: 200_000, count: 1 });
    expect(c.by_property[0]!.property_id).toBe(propB); // ordered by amount desc
  });

  it('lists outstanding invoices oldest-first, billing to the assigned contact', async () => {
    const c = await service.getCockpit({ accessiblePropertyIds: [propA, propB] });
    expect(c.invoices).toHaveLength(3);
    expect(c.invoices[0]!.property_id).toBe(propB); // 100-day invoice leads
    expect(c.invoices[0]!.bill_to_name).toBe('Neo Guest'); // no billing contact on B
    const withBilling = c.invoices.find((i) => i.property_id === propA)!;
    expect(withBilling.bill_to_name).toBe('Acme Accounts'); // A's billing contact
  });

  it('scopes to the caller’s accessible properties', async () => {
    const onlyA = await service.getCockpit({ accessiblePropertyIds: [propA] });
    expect(onlyA.summary.total_receivable).toBe(150_000); // propB's 200k excluded
    expect(onlyA.summary.open_invoices).toBe(2);
    expect(onlyA.by_property.every((p) => p.property_id === propA)).toBe(true);

    const none = await service.getCockpit({ accessiblePropertyIds: [] });
    expect(none.summary.total_receivable).toBe(0);
    expect(none.invoices).toHaveLength(0);
  });
});
