/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the owner-statement feature: for a date window, LANDLORD-owned units
 * (migration 054) roll up into a per-landlord payout — recognised revenue (PAID
 * invoices) and booked occupancy per unit, less the approved repair cost charged
 * to that owner, netting to what LSP owes them. LIFESTYLE units and rows outside
 * the window must never appear, and everything is scoped to the caller's
 * accessible properties.
 *
 * Fixtures are self-created inside a fixed historical month, so the occupancy
 * math is deterministic whatever "today" is (CI's lsp_test is seeded minimally;
 * global/admin scope would be non-deterministic).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ReportsRepository } from '../../../src/modules/reports/reports.repository.js';
import { ReportsService } from '../../../src/modules/reports/reports.service.js';

const service = new ReportsService(new ReportsRepository(db));

// A fixed, fully-past window so the fixtures land in it regardless of the clock.
const FROM = '2025-03-01';
const TO = '2025-03-31';
const DAYS = 31;
const round1 = (x: number) => Math.round(x * 10) / 10;
const d = (s: string) => new Date(`${s}T00:00:00Z`);

let userId: string;
let propId: string;
let buildingId: string;
let kagiso1: string; // LANDLORD — Kagiso Properties, has a booked stay
let kagiso2: string; // LANDLORD — Kagiso Properties, only a repair cost
let boitumelo: string; // LANDLORD — Boitumelo Trust
let lifestyle: string; // LIFESTYLE control — must never surface
const resIds: string[] = [];
const invIds: string[] = [];
const woIds: string[] = [];

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();

  const user = await db.insertInto('users')
    .values({ role_id: role.id, name: 'Owners Test', email: `owners-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow();
  userId = user.id;

  const prop = await db.insertInto('properties').values({ name: `OWN_STMT_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  propId = prop.id;

  const building = await db.insertInto('buildings').values({ property_id: propId, name: `OWN_BLDG_${uniq}` }).returning('id').executeTakeFirstOrThrow();
  buildingId = building.id;

  const rooms = await db.insertInto('rooms')
    .values([
      { name: 'Kagiso 1', code: `OWN-K1-${uniq}`, building_id: buildingId, ownership: 'LANDLORD', landlord_name: 'Kagiso Properties', landlord_phone: '+267 71 000 000', created_by: userId, updated_by: userId },
      { name: 'Kagiso 2', code: `OWN-K2-${uniq}`, building_id: buildingId, ownership: 'LANDLORD', landlord_name: 'Kagiso Properties', created_by: userId, updated_by: userId },
      { name: 'Boitumelo 1', code: `OWN-B1-${uniq}`, building_id: buildingId, ownership: 'LANDLORD', landlord_name: 'Boitumelo Trust', landlord_phone: '+267 72 111 111', created_by: userId, updated_by: userId },
      { name: 'Lifestyle 1', code: `OWN-F1-${uniq}`, building_id: buildingId, created_by: userId, updated_by: userId }, // defaults to LIFESTYLE
    ])
    .returning(['id', 'name']).execute();
  kagiso1 = rooms.find((r) => r.name === 'Kagiso 1')!.id;
  kagiso2 = rooms.find((r) => r.name === 'Kagiso 2')!.id;
  boitumelo = rooms.find((r) => r.name === 'Boitumelo 1')!.id;
  lifestyle = rooms.find((r) => r.name === 'Lifestyle 1')!.id;

  const guest = await db.insertInto('contacts')
    .values({ type: 'individual', name: 'Owners Guest', created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow();
  const guestId = guest.id;

  // Reservations (DATE columns). Kagiso 1: 10 nights; Boitumelo: 5 nights;
  // Lifestyle control: 8 nights (must be excluded).
  const res = await db.insertInto('reservations')
    .values([
      { contact_id: guestId, room_id: kagiso1, check_in_date: d('2025-03-01'), check_out_date: d('2025-03-11'), status: 'CHECKED_OUT', created_by: userId, updated_by: userId },
      { contact_id: guestId, room_id: boitumelo, check_in_date: d('2025-03-01'), check_out_date: d('2025-03-06'), status: 'CHECKED_OUT', created_by: userId, updated_by: userId },
      { contact_id: guestId, room_id: lifestyle, check_in_date: d('2025-03-01'), check_out_date: d('2025-03-09'), status: 'CHECKED_OUT', created_by: userId, updated_by: userId },
    ])
    .returning(['id', 'room_id']).execute();
  resIds.push(...res.map((r) => r.id));
  const resKagiso1 = res.find((r) => r.room_id === kagiso1)!.id;
  const resBoitumelo = res.find((r) => r.room_id === boitumelo)!.id;
  const resLifestyle = res.find((r) => r.room_id === lifestyle)!.id;

  const inv = (over: Record<string, unknown>) => ({
    number: `OWN-${uniq}-${Math.random().toString(36).slice(2, 8)}`,
    subtotal_amount: 0, tax_rate_bps: 0, tax_amount: 0, total_amount: 0,
    issued_by: userId, created_by: userId, updated_by: userId, ...over,
  });

  const invoices = await db.insertInto('invoices')
    .values([
      // Kagiso 1 — recognised revenue in the window.
      inv({ reservation_id: resKagiso1, kind: 'BALANCE', status: 'PAID', total_amount: 100_000, created_at: d('2025-03-05') }),
      // Kagiso 1 — a PAID invoice BEFORE the window: must NOT count.
      inv({ reservation_id: resKagiso1, kind: 'BALANCE', status: 'PAID', total_amount: 999_999, created_at: d('2025-02-15') }),
      // Kagiso 1 — an ISSUED (unpaid) invoice in the window: must NOT count.
      inv({ reservation_id: resKagiso1, kind: 'DEPOSIT', status: 'ISSUED', total_amount: 40_000, created_at: d('2025-03-06') }),
      // Boitumelo — recognised revenue in the window.
      inv({ reservation_id: resBoitumelo, kind: 'BALANCE', status: 'PAID', total_amount: 60_000, created_at: d('2025-03-04') }),
      // Lifestyle control — PAID in the window but on a LIFESTYLE unit: excluded.
      inv({ reservation_id: resLifestyle, kind: 'BALANCE', status: 'PAID', total_amount: 500_000, created_at: d('2025-03-04') }),
    ])
    .returning('id').execute();
  invIds.push(...invoices.map((i) => i.id));

  // Approved repair costs charged to owners (only approved spend counts). All
  // marked COMPLETED so the global reminder sweep (which nags OPEN/unassigned
  // orders) never picks up these aged fixtures when it runs in a parallel suite.
  const orders = await db.insertInto('maintenance_work_orders')
    .values([
      { room_id: kagiso2, title: 'Kagiso 2 geyser', status: 'COMPLETED', reported_by: userId, cost_amount: 25_000, cost_approved_by: userId, cost_approved_at: d('2025-03-10'), opened_at: d('2025-03-10') },
      { room_id: boitumelo, title: 'Boitumelo tap', status: 'COMPLETED', reported_by: userId, cost_amount: 10_000, cost_approved_by: userId, cost_approved_at: d('2025-03-12'), opened_at: d('2025-03-12') },
      // Kagiso 1 — cost NOT yet approved: must NOT count.
      { room_id: kagiso1, title: 'Kagiso 1 pending', status: 'COMPLETED', reported_by: userId, cost_amount: 77_000, opened_at: d('2025-03-15') },
      // Lifestyle control — approved cost on a LIFESTYLE unit: excluded.
      { room_id: lifestyle, title: 'Lifestyle repair', status: 'COMPLETED', reported_by: userId, cost_amount: 33_000, cost_approved_by: userId, cost_approved_at: d('2025-03-14'), opened_at: d('2025-03-14') },
    ])
    .returning('id').execute();
  woIds.push(...orders.map((o) => o.id));
});

afterAll(async () => {
  await db.deleteFrom('invoices').where('id', 'in', invIds).execute();
  await db.deleteFrom('maintenance_work_orders').where('id', 'in', woIds).execute();
  await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  await db.deleteFrom('rooms').where('id', 'in', [kagiso1, kagiso2, boitumelo, lifestyle]).execute();
  await db.deleteFrom('contacts').where('created_by', '=', userId).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

const forProp = () => service.getOwnerStatements({ from: FROM, to: TO, accessiblePropertyIds: [propId] });

describe('Owner statements — per-landlord payout (live DB)', () => {
  it('groups LANDLORD units by owner and excludes LIFESTYLE units', async () => {
    const r = await forProp();
    expect(r.from).toBe(FROM);
    expect(r.to).toBe(TO);
    expect(r.owners.map((o) => o.landlord_name)).toEqual(['Kagiso Properties', 'Boitumelo Trust']); // best net first
    // The LIFESTYLE unit and its money never surface.
    const allRoomIds = r.owners.flatMap((o) => o.units.map((u) => u.room_id));
    expect(allRoomIds).not.toContain(lifestyle);
  });

  it('nets recognised revenue against owner-charged repair cost per landlord', async () => {
    const r = await forProp();
    const kagiso = r.owners.find((o) => o.landlord_name === 'Kagiso Properties')!;
    expect(kagiso.unit_count).toBe(2);
    expect(kagiso.landlord_phone).toBe('+267 71 000 000'); // first known phone across units
    expect(kagiso.revenue).toBe(100_000); // pre-window PAID + in-window ISSUED both excluded
    expect(kagiso.maintenance_cost).toBe(25_000); // pending (unapproved) cost excluded
    expect(kagiso.net).toBe(75_000);
    expect(kagiso.nights).toBe(10);
    expect(kagiso.room_nights_available).toBe(2 * DAYS);
    expect(kagiso.occupancy_pct).toBe(round1((10 / (2 * DAYS)) * 100));

    const boitumelo = r.owners.find((o) => o.landlord_name === 'Boitumelo Trust')!;
    expect(boitumelo.unit_count).toBe(1);
    expect(boitumelo.revenue).toBe(60_000);
    expect(boitumelo.maintenance_cost).toBe(10_000);
    expect(boitumelo.net).toBe(50_000);
    expect(boitumelo.occupancy_pct).toBe(round1((5 / DAYS) * 100));
  });

  it('lists each owned unit with its own revenue, occupancy and cost', async () => {
    const r = await forProp();
    const kagiso = r.owners.find((o) => o.landlord_name === 'Kagiso Properties')!;
    const k1 = kagiso.units.find((u) => u.room_id === kagiso1)!;
    const k2 = kagiso.units.find((u) => u.room_id === kagiso2)!;
    // Unit 1 earned; unit 2 only carries an approved repair cost (a zero-revenue line).
    expect(k1.revenue).toBe(100_000);
    expect(k1.nights).toBe(10);
    expect(k1.occupancy_pct).toBe(round1((10 / DAYS) * 100));
    expect(k1.maintenance_cost).toBe(0);
    expect(k1.net).toBe(100_000);
    expect(k2.revenue).toBe(0);
    expect(k2.nights).toBe(0);
    expect(k2.maintenance_cost).toBe(25_000);
    expect(k2.net).toBe(-25_000);
  });

  it('rolls the owners up into portfolio totals', async () => {
    const r = await forProp();
    expect(r.totals).toEqual({
      landlords: 2,
      units: 3,
      revenue: 160_000,
      maintenance_cost: 35_000,
      net: 125_000,
    });
  });

  it('scopes to the caller’s accessible properties', async () => {
    const none = await service.getOwnerStatements({ from: FROM, to: TO, accessiblePropertyIds: [] });
    expect(none.owners).toHaveLength(0);
    expect(none.totals).toEqual({ landlords: 0, units: 0, revenue: 0, maintenance_cost: 0, net: 0 });
  });
});
