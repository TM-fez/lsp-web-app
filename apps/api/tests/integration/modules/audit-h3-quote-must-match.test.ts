/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit 2026-10-11, H-3) The first payment on a booking freezes its agreed total from the
 * hold's quote. A hold attached to a booking never checked that the quote was for that
 * booking, so someone who can quote and take payments (reception) could pay a month's stay
 * through a one-night quote — the month agreed, confirmed and "paid in full" at a one-night
 * price: a discount nobody approved. The quote must now match the booking's nights and kind
 * of unit, and a channel block can't be paid through a hold at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { HoldsService } from '../../../src/modules/holds/holds.service.js';
import { HoldsRepository } from '../../../src/modules/holds/holds.repository.js';
import { QuotesService } from '../../../src/modules/quotes/quotes.service.js';
import { QuotesRepository } from '../../../src/modules/quotes/quotes.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId: string, propId: string, bldId: string, roomId: string, guestId: string, planId: string;
const quoteIds: string[] = [], holdIds: string[] = [], reservationIds: string[] = [];
const meta = () => ({ userId });

const pricing = new PricingService(new PricingRepository(db));
const quotes = new QuotesService(new QuotesRepository(db), pricing);
const holds = new HoldsService(new HoldsRepository(db), quotes);

const d = (iso: string) => new Date(iso);
async function quote(ci: string, co: string, unit: 'CONFERENCE' | 'SUITE' = 'CONFERENCE') {
  const nights = Math.round((d(co).getTime() - d(ci).getTime()) / 86_400_000);
  const id = (await db.insertInto('quotes').values({
    rate_plan_id: planId, unit_type: unit, check_in_date: d(ci), check_out_date: d(co), guests: 1, nights,
    base_amount: 100_000, tax_rate_bps: 0, tax_amount: 0, deposit_amount: 50_000, total_amount: 100_000,
    created_by: userId, expires_at: new Date(Date.now() + 3_600_000),
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  quoteIds.push(id);
  return id;
}
async function booking(ci: string, co: string) {
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, check_in_date: d(ci), check_out_date: d(co), status: 'PENDING', source: 'DIRECT',
    created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  reservationIds.push(id);
  return id;
}

beforeAll(async () => {
  const role = (await db.selectFrom('roles').select('id').where('name', '=', 'reception').executeTakeFirstOrThrow()).id;
  userId = (await db.insertInto('users').values({ role_id: role, name: 'H3', email: `h3-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `H3_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `H3B_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'H3', code: `H3-${uniq}`.slice(0, 20), type: 'CONFERENCE', capacity: 2, building_id: bldId, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `H3 guest ${uniq}`, created_by: userId, updated_by: userId } as never).returning('id').executeTakeFirstOrThrow()).id;
  planId = (await db.insertInto('rate_plans').values({
    unit_type: 'CONFERENCE', name: `H3 plan ${uniq}`, nightly_rate: 100_000, weekly_rate: 600_000, monthly_rate: 2_400_000,
    max_guests: 2, deposit_pct: 50, tax_rate_bps: 0, active: false, created_by: userId, updated_by: userId,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  if (holdIds.length) await db.deleteFrom('holds').where('id', 'in', holdIds).execute();
  if (reservationIds.length) await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
  await db.deleteFrom('quotes').where('id', 'in', quoteIds).execute();
  await db.deleteFrom('rate_plans').where('id', '=', planId).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('Audit H-3 — a hold on a booking must use a quote for that booking', () => {
  it('refuses a one-night quote on a month-long booking', async () => {
    const month = await booking('2037-01-01', '2037-01-31');
    const cheap = await quote('2037-01-01', '2037-01-02');
    await expect(holds.createHold({ quote_id: cheap, reservation_id: month } as never, meta()))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses a quote for the same nights but a different kind of unit', async () => {
    const stay = await booking('2037-02-01', '2037-02-03');
    const other = await quote('2037-02-01', '2037-02-03', 'SUITE');
    await expect(holds.createHold({ quote_id: other, reservation_id: stay } as never, meta()))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses a hold that names a different unit from the booking’s', async () => {
    const stay = await booking('2037-03-01', '2037-03-03');
    const q = await quote('2037-03-01', '2037-03-03');
    await expect(holds.createHold({ quote_id: q, reservation_id: stay, room_id: '00000000-0000-4000-a000-000000000099' } as never, meta()))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('accepts the quote the booking wizard makes for the booking’s own stay', async () => {
    const stay = await booking('2037-04-01', '2037-04-03');
    const q = await quote('2037-04-01', '2037-04-03');
    const hold = await holds.createHold({ quote_id: q, reservation_id: stay, room_id: roomId } as never, meta());
    holdIds.push(hold.id);
    expect(hold.reservation_id).toBe(stay);
  });
});
