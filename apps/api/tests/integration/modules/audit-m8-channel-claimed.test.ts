/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * (Audit 2026-10-11, M-8) When a guest cancelled or changed dates on Booking.com, the importer
 * changed the claimed LSP booking with a bare UPDATE: no row lock, no audit row, no invoice
 * update, no re-price. A cancelled stay kept its open invoice; a move left the agreed total
 * billing the old nights; and a guest who checked in while the sync ran could be cancelled.
 * Now both go through the same locked, audited booking update as a change at the desk.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { ChannelRepository } from '../../../src/modules/channel/channel.repository.js';
import { SYSTEM_USER_ID } from '../../../src/modules/channel/channel.types.js';

const repo = new ChannelRepository(db);
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let propId: string, bldId: string, roomId: string, guestId: string;
const resIds: string[] = [];
const invIds: string[] = [];

async function booking(status: string, from: string, to: string, folioTotal: number | null = null) {
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: roomId, check_in_date: new Date(from), check_out_date: new Date(to),
    status, source: 'BOOKING_COM', external_uid: `m8-${uniq}-${resIds.length}`, folio_total_amount: folioTotal,
    created_by: SYSTEM_USER_ID, updated_by: SYSTEM_USER_ID,
  } as never).returning('id').executeTakeFirstOrThrow()).id;
  resIds.push(id);
  return id;
}
const row = (id: string) =>
  db.selectFrom('reservations').select(['status', 'check_in_date', 'check_out_date']).where('id', '=', id).executeTakeFirstOrThrow();
const audits = (id: string) =>
  db.selectFrom('audit_logs').select(['action', 'diff']).where('entity', '=', 'reservations').where('entity_id', '=', id).execute();

beforeAll(async () => {
  propId = (await db.insertInto('properties').values({ name: `M8_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `M8B_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  roomId = (await db.insertInto('rooms').values({ name: 'M8', code: `M8-${uniq}`.slice(0, 20), building_id: bldId, created_by: SYSTEM_USER_ID, updated_by: SYSTEM_USER_ID })
    .returning('id').executeTakeFirstOrThrow()).id;
  guestId = (await db.insertInto('contacts').values({ name: `M8 guest ${uniq}`, created_by: SYSTEM_USER_ID, updated_by: SYSTEM_USER_ID } as never)
    .returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  await db.deleteFrom('invoices').where('reservation_id', 'in', resIds).execute();
  await db.deleteFrom('audit_logs').where('entity_id', 'in', [...resIds, ...invIds]).execute();
  await db.deleteFrom('reservations').where('id', 'in', resIds).execute();
  await db.deleteFrom('contacts').where('id', '=', guestId).execute();
  await db.deleteFrom('rooms').where('id', '=', roomId).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
});

describe('Audit M-8 — Booking.com changes to a claimed booking', () => {
  it('a cancel is audited and voids the booking’s open invoice', async () => {
    const id = await booking('CONFIRMED', '2039-01-10', '2039-01-12', 200_000);
    const inv = (await db.insertInto('invoices').values({
      number: `M8-${uniq}`, reservation_id: id, kind: 'BALANCE', status: 'ISSUED', subtotal_amount: 200_000, tax_rate_bps: 0,
      tax_amount: 0, total_amount: 200_000, issued_by: SYSTEM_USER_ID, created_by: SYSTEM_USER_ID, updated_by: SYSTEM_USER_ID,
    } as never).returning('id').executeTakeFirstOrThrow()).id;
    invIds.push(inv);

    expect(await repo.cancelOtaBooking(id, ['BLOCKED', 'CONFIRMED'])).toBe(true);
    expect((await row(id)).status).toBe('CANCELLED');
    expect((await audits(id)).some((a) => (a.diff as { status?: string }).status === 'CANCELLED')).toBe(true);
    const i = await db.selectFrom('invoices').select('status').where('id', '=', inv).executeTakeFirstOrThrow();
    expect(i.status).toBe('VOID');
  });

  it('never cancels a guest who is already checked in', async () => {
    const id = await booking('CHECKED_IN', '2039-02-10', '2039-02-12');
    expect(await repo.cancelOtaBooking(id, ['BLOCKED', 'CONFIRMED'])).toBe(false);
    expect((await row(id)).status).toBe('CHECKED_IN');
  });

  it('moves a confirmed booking’s dates with an audit row', async () => {
    const id = await booking('CONFIRMED', '2039-03-10', '2039-03-12');
    expect(await repo.moveClaimedDates(id, { checkIn: new Date('2039-03-11'), checkOut: new Date('2039-03-13') })).toBe('moved');
    const r = await row(id);
    expect(new Date(r.check_in_date).toISOString().slice(0, 10)).toBe('2039-03-11');
    expect((await audits(id)).length).toBeGreaterThan(0);
    expect(await repo.moveClaimedDates(id, { checkIn: new Date('2039-03-11'), checkOut: new Date('2039-03-13') })).toBe('unchanged');
  });

  it('never moves an in-house guest — left for staff', async () => {
    const id = await booking('CHECKED_IN', '2039-04-10', '2039-04-12');
    expect(await repo.moveClaimedDates(id, { checkIn: new Date('2039-04-09'), checkOut: new Date('2039-04-12') })).toBe('skipped');
    expect(new Date((await row(id)).check_in_date).toISOString().slice(0, 10)).toBe('2039-04-10');
  });
});
