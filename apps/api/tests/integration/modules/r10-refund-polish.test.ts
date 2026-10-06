/**
 * Requires a running PostgreSQL instance with migrations applied (lsp_test).
 *
 * Round 10 (2026-10-06) — refund polish, against real SQL.
 *  #1 A refund that would make a LIVE stay free (agreed total → P0) is a question: 409
 *     'Full Refund' until it is answered, and nothing is written. Partial refunds, refunds of
 *     a shortened stay's credit, and refunds on cancelled bookings are not asked.
 *  #6 A reason of only spaces is refused; a booking read by id carries its display names;
 *     a booking refunded in full before refunds lowered the total is listed for review.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../../../src/config/db.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';
import { QuotesService } from '../../../src/modules/quotes/quotes.service.js';
import { QuotesRepository } from '../../../src/modules/quotes/quotes.repository.js';
import { InvoicesService } from '../../../src/modules/invoices/invoices.service.js';
import { InvoicesRepository } from '../../../src/modules/invoices/invoices.repository.js';
import { FilesRepository } from '../../../src/modules/files/files.repository.js';
import { RefundInvoiceSchema } from '../../../src/modules/invoices/invoices.types.js';
import { findUnloweredRefunds } from '../../../src/modules/reservations/reservations.unlowered.js';

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const STAY = 222_300; // P2,223.00
const meta = () => ({ userId, ip: '127.0.0.1', requestId: randomUUID() }) as never;

const pricing = new PricingService(new PricingRepository(db));
const invoices = new InvoicesService(new InvoicesRepository(db), new QuotesService(new QuotesRepository(db), pricing), new FilesRepository(db));
const reservations = new ReservationsService(new ReservationsRepository(db));

let userId: string, propId: string, bldId: string, guestId: string, coordId: string, billerId: string;
const roomIds: string[] = [];
const reservationIds: string[] = [];
let cursor = 0;

async function paidBooking(opts: { status: 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED'; agreed: number | null; paid: number }) {
  const room = (await db.insertInto('rooms').values({
    name: `R10 ${cursor}`, code: `R10-${uniq}-${cursor}`, capacity: 2, building_id: bldId, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  roomIds.push(room);
  cursor += 3;
  const id = (await db.insertInto('reservations').values({
    contact_id: guestId, room_id: room, check_in_date: new Date(`2038-01-${String(1 + (cursor % 25)).padStart(2, '0')}`),
    check_out_date: new Date(`2038-02-${String(1 + (cursor % 25)).padStart(2, '0')}`),
    status: opts.status, source: 'DIRECT', folio_total_amount: opts.agreed,
    booking_coordinator_id: coordId, billing_contact_id: billerId, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  reservationIds.push(id);
  const receipt = (await db.insertInto('invoices').values({
    number: `INV-R10-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, reservation_id: id, kind: 'DEPOSIT',
    subtotal_amount: opts.paid, tax_rate_bps: 0, tax_amount: 0, total_amount: opts.paid, status: 'PAID',
    issued_by: userId, created_by: userId, updated_by: userId,
  }).returning('id').executeTakeFirstOrThrow()).id;
  return { id, receipt };
}

const agreed = async (id: string) =>
  (await db.selectFrom('reservations').select('folio_total_amount').where('id', '=', id).executeTakeFirstOrThrow()).folio_total_amount;
const creditNotes = async (id: string) =>
  (await db.selectFrom('invoices').select('id').where('reservation_id', '=', id).where('kind', '=', 'REFUND').execute()).length;

beforeAll(async () => {
  const role = await db.selectFrom('roles').select('id').limit(1).executeTakeFirstOrThrow();
  userId = (await db.insertInto('users').values({ role_id: role.id, name: 'R10', email: `r10-${uniq}@t.local`, password_hash: 'x' }).returning('id').executeTakeFirstOrThrow()).id;
  propId = (await db.insertInto('properties').values({ name: `R10_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  bldId = (await db.insertInto('buildings').values({ property_id: propId, name: `R10B_${uniq}` }).returning('id').executeTakeFirstOrThrow()).id;
  const contact = async (name: string) =>
    (await db.insertInto('contacts').values({ name, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
  guestId = await contact('Garth Miller');
  coordId = await contact('Lerato Coordinator');
  billerId = await contact('Access Bank');
});

afterAll(async () => {
  if (reservationIds.length) {
    await db.deleteFrom('invoices').where('reservation_id', 'in', reservationIds).execute();
    await db.deleteFrom('reservations').where('id', 'in', reservationIds).execute();
  }
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  if (roomIds.length) await db.deleteFrom('rooms').where('id', 'in', roomIds).execute();
  await db.deleteFrom('contacts').where('id', 'in', [guestId, coordId, billerId]).execute();
  await db.deleteFrom('buildings').where('id', '=', bldId).execute();
  await db.deleteFrom('properties').where('id', '=', propId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
});

describe('R10 #1 — refunding a live stay to P0 is a question', () => {
  it('asks first (409 Full Refund) and writes nothing; answered, it refunds and the stay is free', async () => {
    const b = await paidBooking({ status: 'CONFIRMED', agreed: STAY, paid: STAY });

    const err = await invoices.refundInvoice(b.receipt, STAY, 'guest asked', meta()).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 409, error: 'Full Refund' });
    expect(err.message).toMatch(/makes the stay free/);
    expect(await creditNotes(b.id)).toBe(0);
    expect(await agreed(b.id)).toBe(STAY);

    await invoices.refundInvoice(b.receipt, STAY, 'guest asked', meta(), { confirmFullRefund: true });
    expect(await creditNotes(b.id)).toBe(1);
    expect(await agreed(b.id)).toBe(0);
  });

  it('asks on a checked-in stay too', async () => {
    const b = await paidBooking({ status: 'CHECKED_IN', agreed: STAY, paid: STAY });
    await expect(invoices.refundInvoice(b.receipt, STAY, 'x', meta())).rejects.toMatchObject({ error: 'Full Refund' });
  });

  it('does not ask for a partial refund', async () => {
    const b = await paidBooking({ status: 'CONFIRMED', agreed: STAY, paid: STAY });
    await invoices.refundInvoice(b.receipt, 50_000, 'goodwill', meta());
    expect(await agreed(b.id)).toBe(STAY - 50_000);
  });

  it('does not ask on a cancelled booking — the stay is already off', async () => {
    const b = await paidBooking({ status: 'CANCELLED', agreed: STAY, paid: STAY });
    await invoices.refundInvoice(b.receipt, STAY, 'cancelled in time', meta());
    expect(await creditNotes(b.id)).toBe(1);
  });

  it('does not ask when handing back a shortened stay’s overpayment — the stay still costs something', async () => {
    // Agreed P1,482 after the stay was shortened; P2,223 was paid; P741 is owed back.
    const b = await paidBooking({ status: 'CONFIRMED', agreed: 148_200, paid: STAY });
    await invoices.refundInvoice(b.receipt, 74_100, 'stay shortened', meta());
    expect(await agreed(b.id)).toBe(148_200);
  });
});

describe('R10 #6 — smaller items', () => {
  it('refuses a refund reason of only spaces', () => {
    expect(RefundInvoiceSchema.safeParse({ amount: 100, reason: '   ' }).success).toBe(false);
    expect(RefundInvoiceSchema.parse({ amount: 100, reason: '  late checkout  ' }).reason).toBe('late checkout');
  });

  it('reads a booking by id with its unit, guest, coordinator and bill-to names', async () => {
    const b = await paidBooking({ status: 'CONFIRMED', agreed: STAY, paid: 10_000 });
    const r = await reservations.getReservationDetail(b.id, propId);
    expect(r).toMatchObject({
      guest_name: 'Garth Miller',
      room_name: `R10 ${cursor - 3}`,
      booking_coordinator_name: 'Lerato Coordinator',
      billing_contact_name: 'Access Bank',
      property_id: propId,
    });
    expect(r.room_code).toMatch(/^R10-/);
    // Still scoped: another property's caller gets "not found".
    await expect(reservations.getReservationDetail(b.id, randomUUID())).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lists live bookings refunded in full whose agreed total was never lowered — and only those', async () => {
    const legacy = await paidBooking({ status: 'CONFIRMED', agreed: STAY, paid: STAY });
    await db.updateTable('invoices').set({ status: 'REFUNDED' }).where('id', '=', legacy.receipt).execute();
    await db.insertInto('invoices').values({
      number: `INV-R10-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, reservation_id: legacy.id, kind: 'REFUND',
      subtotal_amount: STAY, tax_rate_bps: 0, tax_amount: 0, total_amount: STAY, status: 'PAID', refund_of_invoice_id: legacy.receipt,
      issued_by: userId, created_by: userId, updated_by: userId,
    }).execute();
    const lowered = await paidBooking({ status: 'CONFIRMED', agreed: STAY, paid: STAY });
    await invoices.refundInvoice(lowered.receipt, STAY, 'answered', meta(), { confirmFullRefund: true });

    const ids = (await findUnloweredRefunds(db)).map((r) => r.reservation_id);
    expect(ids).toContain(legacy.id);
    expect(ids).not.toContain(lowered.id);
    const row = (await findUnloweredRefunds(db)).find((r) => r.reservation_id === legacy.id)!;
    expect(row).toMatchObject({ agreed_total: STAY, refunded: STAY, guest_name: 'Garth Miller' });
  });
});
