/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the invoice list property filter keeps Unattributed (null-chain) open
 * invoices visible in every active property — the Finance Cockpit already counted
 * them via LEFT JOIN, and the old EXISTS filter hid them from Accounts.
 *
 * Also proves an attributed invoice in property B never leaks into property A's
 * list, so the coalesce rule does not weaken H5 scoping for rows that DO resolve.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { InvoicesRepository } from '../../../src/modules/invoices/invoices.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const repo = new InvoicesRepository(db);

let userId: string;
let propA: string;
let propB: string;
let buildingA: string;
let buildingB: string;
let roomA: string;
let roomB: string;
let guestId: string;
let resA: string;
let resB: string;
let invAttributedA: string;
let invAttributedB: string;
let invUnattributed: string;

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (
    await db
      .insertInto('users')
      .values({
        role_id: role.id,
        name: 'InvScope Test',
        email: `inv-scope-${uniq}@test.local`,
        password_hash: 'x',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  const props = await db
    .insertInto('properties')
    .values([{ name: `INV_SCOPE_A_${uniq}` }, { name: `INV_SCOPE_B_${uniq}` }])
    .returning(['id', 'name'])
    .execute();
  propA = props.find((p) => p.name.includes('_A_'))!.id;
  propB = props.find((p) => p.name.includes('_B_'))!.id;

  const buildings = await db
    .insertInto('buildings')
    .values([
      { property_id: propA, name: `INV_SCOPE_BLDG_A_${uniq}` },
      { property_id: propB, name: `INV_SCOPE_BLDG_B_${uniq}` },
    ])
    .returning(['id', 'property_id'])
    .execute();
  buildingA = buildings.find((b) => b.property_id === propA)!.id;
  buildingB = buildings.find((b) => b.property_id === propB)!.id;

  const rooms = await db
    .insertInto('rooms')
    .values([
      {
        name: 'Scope A',
        code: `ISA-${uniq}`,
        building_id: buildingA,
        created_by: userId,
        updated_by: userId,
      },
      {
        name: 'Scope B',
        code: `ISB-${uniq}`,
        building_id: buildingB,
        created_by: userId,
        updated_by: userId,
      },
    ])
    .returning(['id', 'building_id'])
    .execute();
  roomA = rooms.find((r) => r.building_id === buildingA)!.id;
  roomB = rooms.find((r) => r.building_id === buildingB)!.id;

  guestId = (
    await db
      .insertInto('contacts')
      .values({
        type: 'individual',
        name: 'Scope Guest',
        email: `scope-${uniq}@test.local`,
        created_by: userId,
        updated_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

  const reservations = await db
    .insertInto('reservations')
    .values([
      {
        contact_id: guestId,
        room_id: roomA,
        check_in_date: new Date('2030-01-01'),
        check_out_date: new Date('2030-01-03'),
        status: 'CONFIRMED',
        created_by: userId,
        updated_by: userId,
      },
      {
        contact_id: guestId,
        room_id: roomB,
        check_in_date: new Date('2030-02-01'),
        check_out_date: new Date('2030-02-03'),
        status: 'CONFIRMED',
        created_by: userId,
        updated_by: userId,
      },
    ])
    .returning(['id', 'room_id'])
    .execute();
  resA = reservations.find((r) => r.room_id === roomA)!.id;
  resB = reservations.find((r) => r.room_id === roomB)!.id;

  const inv = (over: Record<string, unknown>) => ({
    number: `INV-SCOPE-${uniq}-${Math.random().toString(36).slice(2, 8)}`,
    subtotal_amount: 0,
    tax_rate_bps: 0,
    tax_amount: 0,
    total_amount: 25_700,
    status: 'ISSUED' as const,
    kind: 'BALANCE' as const,
    issued_by: userId,
    created_by: userId,
    updated_by: userId,
    ...over,
  });

  const rows = await db
    .insertInto('invoices')
    .values([
      inv({ reservation_id: resA, total_amount: 25_700 }),
      inv({ reservation_id: resB, total_amount: 59_900 }),
      // No reservation, no hold — the Unattributed case Finance already surfaces.
      inv({ reservation_id: null, hold_id: null, total_amount: 85_500 }),
    ])
    .returning(['id', 'total_amount'])
    .execute();

  invAttributedA = rows.find((r) => Number(r.total_amount) === 25_700)!.id;
  invAttributedB = rows.find((r) => Number(r.total_amount) === 59_900)!.id;
  invUnattributed = rows.find((r) => Number(r.total_amount) === 85_500)!.id;
});

afterAll(async () => {
  await db
    .deleteFrom('invoices')
    .where('id', 'in', [invAttributedA, invAttributedB, invUnattributed])
    .execute();
  await db.deleteFrom('reservations').where('id', 'in', [resA, resB]).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', 'in', [roomA, roomB]).execute();
  await db.deleteFrom('buildings').where('id', 'in', [buildingA, buildingB]).execute();
  await db.deleteFrom('properties').where('id', 'in', [propA, propB]).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('InvoicesRepository.findPaginated — property scope (live DB)', () => {
  it('includes Unattributed invoices in every active property list', async () => {
    const a = await repo.findPaginated({ property_id: propA }, { page: 1, limit: 100 });
    const b = await repo.findPaginated({ property_id: propB }, { page: 1, limit: 100 });
    const idsA = a.data.map((r) => r.id);
    const idsB = b.data.map((r) => r.id);

    expect(idsA).toContain(invUnattributed);
    expect(idsB).toContain(invUnattributed);
    expect(idsA).toContain(invAttributedA);
    expect(idsB).toContain(invAttributedB);
  });

  it('does not leak another property’s attributed invoices', async () => {
    const a = await repo.findPaginated({ property_id: propA }, { page: 1, limit: 100 });
    const idsA = a.data.map((r) => r.id);

    expect(idsA).not.toContain(invAttributedB);
    expect(idsA).toContain(invAttributedA);
  });
});
