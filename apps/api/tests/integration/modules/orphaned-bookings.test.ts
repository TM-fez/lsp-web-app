/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Round 4 (N-1) — the owner-run review of bookings stranded on a deleted unit or guest
 * (src/db/repair-orphaned-bookings.ts). Legacy rows are made the way the old DELETE made them:
 * stamping deleted_at on the unit / guest directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../src/config/db.js';
import { findOrphanedBookings, restoreStrandedParents } from '../../../src/modules/reservations/reservations.orphans.js';
import { todayInPropertyTZ } from '../../../src/core/time.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let userId = '';
let propertyId = '';
let buildingId = '';
const roomIds: string[] = [];
const contactIds: string[] = [];
const reservationIds: string[] = [];

const day = (offset: number) => {
  const d = new Date(`${todayInPropertyTZ()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return new Date(d.toISOString().slice(0, 10));
};
let cursor = 10;
let invSeq = 0;

async function fixture(status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'CHECKED_OUT', opts: { roomDeleted?: boolean; guestDeleted?: boolean; paid?: number; open?: number } = {}) {
  const room = await db.insertInto('rooms').values({
    name: `Orph ${roomIds.length}`, code: `OR-${uniq}-${roomIds.length}`, type: 'CUSTOM', capacity: 2,
    building_id: buildingId, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow();
  roomIds.push(room.id);
  const guest = await db.insertInto('contacts').values({ name: `Orphan Guest ${uniq} ${contactIds.length}`, created_by: userId, updated_by: userId })
    .returning('id').executeTakeFirstOrThrow();
  contactIds.push(guest.id);
  const start = (cursor += 5);
  const res = await db.insertInto('reservations').values({
    contact_id: guest.id, room_id: room.id, check_in_date: day(start), check_out_date: day(start + 2),
    status, source: 'DIRECT', created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow();
  reservationIds.push(res.id);
  const inv = async (amount: number, st: 'PAID' | 'ISSUED') =>
    db.insertInto('invoices').values({
      number: `ORPH-${uniq}-${invSeq++}`, reservation_id: res.id, kind: 'BALANCE', status: st, currency: 'BWP',
      subtotal_amount: amount, tax_rate_bps: 0, tax_amount: 0, total_amount: amount,
      issued_by: userId, created_by: userId, updated_by: userId,
    } as never).execute();
  if (opts.paid) await inv(opts.paid, 'PAID');
  if (opts.open) await inv(opts.open, 'ISSUED');
  if (opts.roomDeleted) await db.updateTable('rooms').set({ deleted_at: new Date(), deleted_by: userId }).where('id', '=', room.id).execute();
  if (opts.guestDeleted) await db.updateTable('contacts').set({ deleted_at: new Date(), deleted_by: userId }).where('id', '=', guest.id).execute();
  return { roomId: room.id, guestId: guest.id, reservationId: res.id };
}

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'Orphan Test', email: `orph-${uniq}@test.local`, password_hash: 'x' })
    .returning('id').executeTakeFirstOrThrow()).id;
  propertyId = (await db.insertInto('properties').values({ name: `ORPH_PROP_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  buildingId = (await db.insertInto('buildings').values({ property_id: propertyId, name: `ORPH_B_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
});

afterAll(async () => {
  if (reservationIds.length) {
    await db.deleteFrom('invoices').where('reservation_id', 'in', reservationIds).execute();
    await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
  }
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('rooms').where('building_id', '=', buildingId).execute();
  if (contactIds.length) await db.deleteFrom('contacts').where('id', 'in', contactIds).execute();
  await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
  await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('review of bookings stranded on a deleted unit / guest', () => {
  it('lists live and unpaid bookings on a deleted unit or guest, and leaves finished history out', async () => {
    const live = await fixture('CONFIRMED', { roomDeleted: true, paid: 148_200 });
    const guestGone = await fixture('PENDING', { guestDeleted: true });
    const owing = await fixture('CHECKED_OUT', { roomDeleted: true, open: 50_000 });
    const history = await fixture('CANCELLED', { roomDeleted: true, paid: 10_000 });
    const settled = await fixture('CHECKED_OUT', { guestDeleted: true, paid: 10_000 });
    const healthy = await fixture('CONFIRMED', {});

    const found = new Map((await findOrphanedBookings(db)).map((r) => [r.reservation_id, r]));
    expect(found.get(live.reservationId)).toMatchObject({ room_deleted: true, paid_amount: 148_200, open_invoice_amount: 0, status: 'CONFIRMED' });
    expect(found.get(guestGone.reservationId)).toMatchObject({ guest_deleted: true, room_deleted: false });
    expect(found.get(owing.reservationId)).toMatchObject({ open_invoice_amount: 50_000, status: 'CHECKED_OUT' });
    expect(found.has(history.reservationId)).toBe(false);
    expect(found.has(settled.reservationId)).toBe(false);
    expect(found.has(healthy.reservationId)).toBe(false);
  });

  it('restore un-deletes exactly the stranded parents, audits them, and is idempotent', async () => {
    const a = await fixture('CONFIRMED', { roomDeleted: true, guestDeleted: true });
    const history = await fixture('CANCELLED', { roomDeleted: true });

    const first = await restoreStrandedParents(db, userId);
    expect(first.rooms_restored).toBeGreaterThanOrEqual(1);
    expect(first.contacts_restored).toBeGreaterThanOrEqual(1);

    const room = await db.selectFrom('rooms').select('deleted_at').where('id', '=', a.roomId).executeTakeFirstOrThrow();
    const guest = await db.selectFrom('contacts').select('deleted_at').where('id', '=', a.guestId).executeTakeFirstOrThrow();
    expect(room.deleted_at).toBeNull();
    expect(guest.deleted_at).toBeNull();
    // A unit that only carries cancelled history stays deleted — that is a legitimate soft delete.
    const hist = await db.selectFrom('rooms').select('deleted_at').where('id', '=', history.roomId).executeTakeFirstOrThrow();
    expect(hist.deleted_at).not.toBeNull();

    const audit = await db.selectFrom('audit_logs').select('id').where('entity', '=', 'rooms').where('entity_id', '=', a.roomId).where('user_id', '=', userId).execute();
    expect(audit).toHaveLength(1);

    const second = await restoreStrandedParents(db, userId);
    expect(second).toEqual({ rooms_restored: 0, contacts_restored: 0 });
    expect((await findOrphanedBookings(db)).filter((r) => reservationIds.includes(r.reservation_id))).toHaveLength(0);
  });
});
