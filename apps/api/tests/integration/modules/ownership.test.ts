/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Proves the Phase 3 owner-attribution mapping (migration 054) flows through the
 * two money surfaces: the expenses view and the maintenance detail both carry
 * the unit's ownership + landlord identity, so a repair bill is always
 * attributable to Lifestyle or the third-party landlord. Fixtures are
 * self-created (CI's lsp_test is seeded minimally).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ExpensesRepository } from '../../../src/modules/expenses/expenses.repository.js';
import { MaintenanceRepository } from '../../../src/modules/maintenance/maintenance.repository.js';

let userId: string;
let propertyId: string;
let buildingId: string;
let landlordRoomId: string;
let lifestyleRoomId: string;
let woLandlord: string;
let woLifestyle: string;

beforeAll(async () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();

  const user = await db
    .insertInto('users')
    .values({ role_id: role.id, name: 'Ownership Test', email: `ownership-${uniq}@test.local`, password_hash: 'x' })
    .returning('id')
    .executeTakeFirstOrThrow();
  userId = user.id;

  const prop = await db
    .insertInto('properties')
    .values({ name: `OWNERSHIP_TEST_PROP_${uniq}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  propertyId = prop.id;

  const building = await db
    .insertInto('buildings')
    .values({ property_id: propertyId, name: `OWNERSHIP_TEST_BLDG_${uniq}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  buildingId = building.id;

  const rooms = await db
    .insertInto('rooms')
    .values([
      {
        name: 'Landlord Unit', code: `OWN-L-${uniq}`, building_id: buildingId,
        ownership: 'LANDLORD', landlord_name: 'Kagiso Properties', landlord_phone: '+267 71 000 000',
        created_by: userId, updated_by: userId,
      },
      {
        name: 'Lifestyle Unit', code: `OWN-F-${uniq}`, building_id: buildingId,
        created_by: userId, updated_by: userId, // ownership defaults to LIFESTYLE
      },
    ])
    .returning(['id', 'name'])
    .execute();
  landlordRoomId = rooms.find((r) => r.name === 'Landlord Unit')!.id;
  lifestyleRoomId = rooms.find((r) => r.name === 'Lifestyle Unit')!.id;

  const orders = await db
    .insertInto('maintenance_work_orders')
    .values([
      { room_id: landlordRoomId, title: 'Landlord repair', reported_by: userId, cost_amount: 50_000 },
      { room_id: lifestyleRoomId, title: 'Lifestyle repair', reported_by: userId, cost_amount: 25_000 },
    ])
    .returning(['id', 'title'])
    .execute();
  woLandlord = orders.find((o) => o.title === 'Landlord repair')!.id;
  woLifestyle = orders.find((o) => o.title === 'Lifestyle repair')!.id;
});

afterAll(async () => {
  await db.deleteFrom('maintenance_work_orders').where('id', 'in', [woLandlord, woLifestyle]).execute();
  await db.deleteFrom('rooms').where('id', 'in', [landlordRoomId, lifestyleRoomId]).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
});

describe('Unit owner attribution (live DB)', () => {
  it('rooms default to LIFESTYLE ownership', async () => {
    const room = await db
      .selectFrom('rooms')
      .select(['ownership', 'landlord_name'])
      .where('id', '=', lifestyleRoomId)
      .executeTakeFirstOrThrow();
    expect(room.ownership).toBe('LIFESTYLE');
    expect(room.landlord_name).toBeNull();
  });

  it('the expenses view attributes each repair cost to its unit owner', async () => {
    const rows = await new ExpensesRepository(db).list();
    const landlord = rows.find((r) => r.id === woLandlord)!;
    const lifestyle = rows.find((r) => r.id === woLifestyle)!;

    expect(landlord.room_ownership).toBe('LANDLORD');
    expect(landlord.landlord_name).toBe('Kagiso Properties');
    expect(lifestyle.room_ownership).toBe('LIFESTYLE');
    expect(lifestyle.landlord_name).toBeNull();
  });

  it('the maintenance detail carries ownership + landlord contact for the drawer', async () => {
    const wo = await new MaintenanceRepository(db).findByIdWithPeople(woLandlord);
    expect(wo?.room_ownership).toBe('LANDLORD');
    expect(wo?.landlord_name).toBe('Kagiso Properties');
    expect(wo?.landlord_phone).toBe('+267 71 000 000');
  });
});
