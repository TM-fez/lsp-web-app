/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the P4.2 Financial Cockpit receivables ledger: open invoices roll up into
 * totals, ageing buckets, per-property debt, and the oldest-first drill-down — and
 * that PAID/settled invoices and REFUND liabilities are handled correctly.
 *
 * Fixtures are self-created and every assertion runs the service scoped to one of the
 * fixture properties. The cockpit shows ONE property's books — the active property, the
 * same scope as the Invoices list — and shows house-wide (unattributed) invoices in every
 * property, so other suites' unattributed rows can appear alongside ours. Assertions
 * therefore read the fixture property's own rows, or filter to fixture ids, rather than
 * assuming the whole snapshot is ours.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { FinanceRepository } from '../../../src/modules/finance/finance.repository.js';
import { FinanceService } from '../../../src/modules/finance/finance.service.js';

const service = new FinanceService(new FinanceRepository(db));
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
// Due dates are plain calendar days (Africa/Gaborone), carried as YYYY-MM-DD.
const dayOffset = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Gaborone' });

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
      inv({ reservation_id: resA, kind: 'BALANCE', status: 'ISSUED', total_amount: 100_000, created_at: daysAgo(10), due_date: dayOffset(-3) }),  // 0-30, 3 days overdue
      inv({ reservation_id: resA, kind: 'DEPOSIT', status: 'PARTIALLY_PAID', total_amount: 50_000, created_at: daysAgo(45), due_date: dayOffset(5) }),   // 31-60, not yet due
      // propA — settled: must NOT count as receivable
      inv({ reservation_id: resA, kind: 'BALANCE', status: 'PAID', total_amount: 999_999, created_at: daysAgo(5) }),
      // propA — refund liability: money we owe the guest, not a receivable
      inv({ reservation_id: resA, kind: 'REFUND', status: 'ISSUED', total_amount: 20_000, created_at: daysAgo(3) }),
      // propB — one very old open receivable (90+ bucket), bills to the guest
      inv({ reservation_id: resB, kind: 'BALANCE', status: 'ISSUED', total_amount: 200_000, created_at: daysAgo(100), due_date: dayOffset(-90) }),
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

const ours = (c: { invoices: Array<{ id: string }> }) => c.invoices.filter((i) => invoiceIds.includes(i.id));

describe('Financial Cockpit — receivables (live DB)', () => {
  it('rolls open DEPOSIT/BALANCE (ISSUED and PARTIALLY_PAID) into the property’s totals, excluding settled invoices', async () => {
    const c = await service.getCockpit({ propertyId: propA });
    const a = c.by_property.find((p) => p.property_id === propA)!;
    expect(a).toMatchObject({ amount: 150_000, count: 2 }); // 100k + 50k (PAID 999k excluded)
    // The headline is exactly the sum of the rows beneath it — one scope, one answer.
    expect(c.summary.total_receivable).toBe(c.by_property.reduce((t, p) => t + p.amount, 0));
    expect(c.summary.open_invoices).toBe(c.by_property.reduce((t, p) => t + p.count, 0));
    expect(c.summary.oldest_days).toBeGreaterThanOrEqual(44);
  });

  it('reports REFUND invoices as a separate payable, not a receivable', async () => {
    const c = await service.getCockpit({ propertyId: propA });
    expect(c.summary.refunds_payable).toBeGreaterThanOrEqual(20_000);
  });

  it('buckets receivables by issue age, always returning the four buckets in order', async () => {
    const c = await service.getCockpit({ propertyId: propA });
    expect(c.aging.map((b) => b.bucket)).toEqual(['0-30', '31-60', '61-90', '90+']);
    const by = Object.fromEntries(c.aging.map((b) => [b.bucket, b]));
    expect(by['0-30']!.amount).toBeGreaterThanOrEqual(100_000);
    expect(by['31-60']).toMatchObject({ amount: 50_000, count: 1 });
    expect(by['61-90']).toMatchObject({ amount: 0, count: 0 });
    expect(by['90+']).toMatchObject({ amount: 0, count: 0 }); // B's 200k is another property's debt

    const b = await service.getCockpit({ propertyId: propB });
    expect(Object.fromEntries(b.aging.map((x) => [x.bucket, x]))['90+']).toMatchObject({ amount: 200_000, count: 1 });
  });

  it('shows only the active property’s attributed debt', async () => {
    const a = await service.getCockpit({ propertyId: propA });
    const b = await service.getCockpit({ propertyId: propB });
    expect(a.by_property.find((p) => p.property_id === propB)).toBeUndefined();
    expect(b.by_property.find((p) => p.property_id === propA)).toBeUndefined();
    expect(b.by_property.find((p) => p.property_id === propB)).toMatchObject({ amount: 200_000, count: 1 });
  });

  it('lists outstanding invoices oldest-first, billing to the assigned contact', async () => {
    const a = await service.getCockpit({ propertyId: propA });
    const mine = ours(a);
    expect(mine).toHaveLength(2);
    expect(mine[0]!.days_outstanding).toBeGreaterThan(mine[1]!.days_outstanding); // oldest first
    expect(mine.every((i) => i.bill_to_name === 'Acme Accounts')).toBe(true); // A's billing contact
    const b = await service.getCockpit({ propertyId: propB });
    expect(ours(b)[0]!.bill_to_name).toBe('Neo Guest'); // no billing contact on B
  });

  it('counts what is past its due date, by the property calendar, and says how late', async () => {
    const a = await service.getCockpit({ propertyId: propA });
    // Only the BALANCE (due 3 days ago) is overdue; the DEPOSIT is not due for 5 days.
    // Assert on OUR rows: the summary also carries house-wide (unattributed) debt, which
    // other suites running in parallel create, so an exact summary figure flakes.
    const overdueOurs = (c: typeof a) =>
      ours(c).filter((i) => i.days_overdue > 0).reduce((sum, i) => sum + i.total_amount, 0);
    expect(overdueOurs(a)).toBe(100_000);
    expect(a.summary.overdue_amount).toBeGreaterThanOrEqual(100_000);
    const late = ours(a).filter((i) => i.days_overdue > 0);
    expect(late).toHaveLength(1);
    expect(late[0]!.days_overdue).toBe(3);
    expect(late[0]!.due_date).toBe(dayOffset(-3));

    const b = await service.getCockpit({ propertyId: propB });
    expect(overdueOurs(b)).toBe(200_000);
    expect(b.summary.overdue_amount).toBeGreaterThanOrEqual(200_000);
    expect(ours(b)[0]!.days_overdue).toBe(90);
  });

  it('shows house-wide (unattributed) debt in every property rather than hiding it from non-admins', async () => {
    const orphan = await db.insertInto('invoices').values({
      number: `FIN-ORPHAN-${Date.now()}`, kind: 'BALANCE', status: 'ISSUED',
      subtotal_amount: 0, tax_rate_bps: 0, tax_amount: 0, total_amount: 12_345,
      issued_by: userId, created_by: userId, updated_by: userId,
    }).returning('id').executeTakeFirstOrThrow();
    invoiceIds.push(orphan.id);

    const a = await service.getCockpit({ propertyId: propA });
    const b = await service.getCockpit({ propertyId: propB });
    expect(a.invoices.some((i) => i.id === orphan.id)).toBe(true);
    expect(b.invoices.some((i) => i.id === orphan.id)).toBe(true);
    expect(a.by_property.find((p) => p.property_id === null)?.property_name).toBe('Unattributed');
  });
});
