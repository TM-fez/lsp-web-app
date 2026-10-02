/**
 * Integration test for the audit-write invariant on the MONEY modules.
 *
 * The rule (CLAUDE.md): every mutation writes its `audit_logs` row in the SAME
 * transaction. Operating expenses, payroll and repair-spend sign-off used to issue the
 * mutation and the audit row as two independent statements, so a failing audit write
 * left the money change committed with no record of who made it — the ledger gains an
 * entry nobody owns. Wrapping both in one transaction is the fix; this proves it.
 *
 * How the failure is forced: a temporary BEFORE INSERT trigger on audit_logs that always
 * raises. That is the only way to fail the audit write ALONE — a bogus meta.userId would
 * trip the same users(id) FK on the money row first (operating_expenses.created_by is
 * NOT NULL REFERENCES users(id)), so it could never isolate the audit step.
 *
 * Requires PostgreSQL with migrations applied.
 *   Start test DB:  docker compose -f infra/docker-compose.test.yml up -d
 *   Run migrations: DATABASE_URL=postgresql://lsp:lsp@localhost:5433/lsp_test npm run db:migrate
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'kysely';
import { db, pool } from '../../../src/config/db.js';
import { OperatingExpensesRepository } from '../../../src/modules/operating-expenses/operating-expenses.repository.js';
import { PayrollRepository } from '../../../src/modules/payroll/payroll.repository.js';
import { ReservationsService } from '../../../src/modules/reservations/reservations.service.js';
import { ReservationsRepository } from '../../../src/modules/reservations/reservations.repository.js';
import { RoomsRepository } from '../../../src/modules/rooms/rooms.repository.js';
import { PricingService } from '../../../src/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../../src/modules/pricing/pricing.repository.js';
import { QuotesService } from '../../../src/modules/quotes/quotes.service.js';
import { QuotesRepository } from '../../../src/modules/quotes/quotes.repository.js';
import { PaymentsService } from '../../../src/modules/payments/payments.service.js';
import { PaymentsRepository } from '../../../src/modules/payments/payments.repository.js';
import { HoldsRepository } from '../../../src/modules/holds/holds.repository.js';

let userId = '';
const meta = () => ({ userId, ip: '127.0.0.1', requestId: null });

// Unique per run so a re-run against a dirty DB can still tell its own rows apart.
const TAG = `audit-atomicity-${Date.now()}`;

/** Make every audit_logs insert fail, as if the audit write hit an error. */
async function breakAuditWrites() {
  await sql`
    CREATE OR REPLACE FUNCTION lsp_test_block_audit() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'audit write failed (test)'; END;
    $$ LANGUAGE plpgsql;
  `.execute(db);
  await sql`
    CREATE TRIGGER lsp_test_block_audit_trg BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION lsp_test_block_audit();
  `.execute(db);
}

async function restoreAuditWrites() {
  await sql`DROP TRIGGER IF EXISTS lsp_test_block_audit_trg ON audit_logs`.execute(db);
  await sql`DROP FUNCTION IF EXISTS lsp_test_block_audit()`.execute(db);
}

beforeAll(async () => {
  const role = await db
    .selectFrom('roles')
    .select('id')
    .where('name', '=', 'admin')
    .executeTakeFirstOrThrow();

  const user = await db
    .insertInto('users')
    .values({
      role_id: role.id,
      name: 'Audit Atomicity Test',
      email: `audit-atomicity-${Date.now()}@lsp.test`,
      password_hash: 'not-used',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  userId = user.id;
});

// Never leave the trigger installed — it would fail every later suite on this database.
afterEach(restoreAuditWrites);

afterAll(async () => {
  await restoreAuditWrites();
  await db.deleteFrom('operating_expenses').where('description', 'like', `${TAG}%`).execute();
  await db.deleteFrom('staff_compensation').where('user_id', '=', userId).execute();
  await db.deleteFrom('audit_logs').where('user_id', '=', userId).execute();
  await db.deleteFrom('users').where('id', '=', userId).execute();
  await pool.end();
});

describe('audit writes are atomic with the mutation they record', () => {
  it('rolls the operating expense back when its audit row cannot be written', async () => {
    const repo = new OperatingExpensesRepository(db);
    const description = `${TAG} rolled back`;
    await breakAuditWrites();

    await expect(
      repo.create(
        {
          property_id: null,
          category: 'UTILITIES',
          description,
          vendor: 'Test Vendor',
          amount: 250_00,
          currency: 'BWP',
          incurred_on: new Date('2026-01-15T00:00:00Z'),
          created_by: userId,
          updated_by: userId,
        },
        meta(),
      ),
    ).rejects.toThrow();

    // The point of the whole fix: no orphan cost row survives the failed audit.
    const orphan = await db
      .selectFrom('operating_expenses')
      .select('id')
      .where('description', '=', description)
      .executeTakeFirst();
    expect(orphan).toBeUndefined();
  });

  it('commits the expense and its audit row together when the audit write succeeds', async () => {
    const repo = new OperatingExpensesRepository(db);
    const description = `${TAG} committed`;

    const created = await repo.create(
      {
        property_id: null,
        category: 'UTILITIES',
        description,
        vendor: 'Test Vendor',
        amount: 250_00,
        currency: 'BWP',
        incurred_on: new Date('2026-01-15T00:00:00Z'),
        created_by: userId,
        updated_by: userId,
      },
      meta(),
    );
    expect(created?.id).toBeTruthy();

    const audit = await db
      .selectFrom('audit_logs')
      .select(['action', 'entity'])
      .where('entity', '=', 'operating_expense')
      .where('entity_id', '=', created!.id)
      .executeTakeFirst();
    expect(audit).toMatchObject({ action: 'CREATE', entity: 'operating_expense' });
  });

  it('rolls a salary change back when its audit row cannot be written', async () => {
    const repo = new PayrollRepository(db);
    await breakAuditWrites();

    await expect(
      repo.upsert(
        userId,
        {
          job_title: 'Test Role',
          gross_amount: 5_000_00,
          frequency: 'MONTHLY',
          payment_method: 'BANK',
          active: true,
        },
        meta(),
      ),
    ).rejects.toThrow();

    // A pay rate that landed with no record of who set it is the worst version of this
    // bug, because the audit trail is the only history staff_compensation keeps.
    const orphan = await db
      .selectFrom('staff_compensation')
      .select('user_id')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    expect(orphan).toBeUndefined();
  });
});

/**
 * Stage 1: a desk payment is quote + hold + intent + attempt + receipt + the re-sized open
 * invoice, in ONE transaction. If any audit row cannot be written, NONE of it may survive —
 * no receipt without an intent, no intent without a receipt, no half-confirmed booking.
 * Unit type CONFERENCE (one active rate plan per type; this run is its own process).
 */
describe('a desk payment is all-or-nothing', () => {
  const stamp = `${Date.now()}`;
  let propertyId = '', buildingId = '', roomId = '', contactId = '', ratePlanId = '', reservationId = '';

  beforeAll(async () => {
    propertyId = (await db.insertInto('properties').values({ name: `AA_PROP_${stamp}` }).returning('id').executeTakeFirstOrThrow()).id;
    buildingId = (await db.insertInto('buildings').values({ property_id: propertyId, name: `AA_BLDG_${stamp}` }).returning('id').executeTakeFirstOrThrow()).id;
    roomId = (await db.insertInto('rooms').values({
      name: 'AA unit', code: `AA-${stamp}`, type: 'CONFERENCE', capacity: 4, building_id: buildingId, created_by: userId, updated_by: userId,
    }).returning('id').executeTakeFirstOrThrow()).id;
    ratePlanId = (await db.insertInto('rate_plans').values({
      unit_type: 'CONFERENCE', name: `AA rate ${stamp}`, nightly_rate: 100_000, weekly_rate: 600_000, monthly_rate: 2_400_000,
      max_guests: 4, deposit_pct: 50, tax_rate_bps: 0, created_by: userId, updated_by: userId,
    }).returning('id').executeTakeFirstOrThrow()).id;
    contactId = (await db.insertInto('contacts').values({ name: 'AA Guest', email: `aa-${stamp}@test.local`, created_by: userId, updated_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
    const d = (n: number) => new Date(new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10));
    reservationId = (await db.insertInto('reservations').values({
      contact_id: contactId, room_id: roomId, check_in_date: d(30), check_out_date: d(32), status: 'PENDING', source: 'WEBSITE',
      created_by: userId, updated_by: userId,
    }).returning('id').executeTakeFirstOrThrow()).id;
  });

  afterAll(async () => {
    await restoreAuditWrites();
    const holdIds = (await db.selectFrom('holds').select('id').where('reservation_id', '=', reservationId).execute()).map((h) => h.id);
    const invIds = (await db.selectFrom('invoices').select('id').where('reservation_id', '=', reservationId).execute()).map((i) => i.id);
    const intentIds = [
      ...(holdIds.length ? (await db.selectFrom('payment_intents').select('id').where('hold_id', 'in', holdIds).execute()).map((i) => i.id) : []),
    ];
    if (intentIds.length) {
      await db.deleteFrom('payment_attempts').where('payment_intent_id', 'in', intentIds).execute();
      await db.deleteFrom('payment_intents').where('id', 'in', intentIds).execute();
    }
    if (invIds.length) await db.deleteFrom('invoices').where('id', 'in', invIds).execute();
    await db.deleteFrom('holds').where('reservation_id', '=', reservationId).execute();
    await db.deleteFrom('reservations').where('id', '=', reservationId).execute();
    await db.deleteFrom('quotes').where('rate_plan_id', '=', ratePlanId).execute();
    await db.deleteFrom('rate_plans').where('id', '=', ratePlanId).execute();
    await db.deleteFrom('contacts').where('id', '=', contactId).execute();
    await db.deleteFrom('rooms').where('id', '=', roomId).execute();
    await db.deleteFrom('buildings').where('id', '=', buildingId).execute();
    await db.deleteFrom('properties').where('id', '=', propertyId).execute();
  });

  const service = () => {
    const pricing = new PricingService(new PricingRepository(db));
    const quotes = new QuotesService(new QuotesRepository(db), pricing);
    const payments = new PaymentsService(new PaymentsRepository(db), new HoldsRepository(db), quotes);
    return new ReservationsService(new ReservationsRepository(db), new RoomsRepository(db), pricing, payments);
  };
  const counts = async () => ({
    invoices: Number((await db.selectFrom('invoices').select(db.fn.count('id').as('n')).where('reservation_id', '=', reservationId).executeTakeFirstOrThrow()).n),
    holds: Number((await db.selectFrom('holds').select(db.fn.count('id').as('n')).where('reservation_id', '=', reservationId).executeTakeFirstOrThrow()).n),
    status: (await db.selectFrom('reservations').select('status').where('id', '=', reservationId).executeTakeFirstOrThrow()).status,
    frozen: (await db.selectFrom('reservations').select('folio_total_amount').where('id', '=', reservationId).executeTakeFirstOrThrow()).folio_total_amount,
  });

  it('leaves no receipt, hold, intent, frozen price or confirmation behind when the audit write fails', async () => {
    await breakAuditWrites();
    await expect(service().markPaid(reservationId, { method: 'CASH' } as never, meta() as never)).rejects.toThrow();
    await restoreAuditWrites();

    expect(await counts()).toEqual({ invoices: 0, holds: 0, status: 'PENDING', frozen: null });
    const intents = await db.selectFrom('payment_intents').select('id').where('invoice_id', 'is', null).where('hold_id', 'is', null).execute();
    expect(intents).toHaveLength(0);
  });

  it('commits receipt, hold, confirmation and frozen price together when the audit writes succeed', async () => {
    const out = await service().markPaid(reservationId, { method: 'CASH', amount: 100_000 } as never, meta() as never);
    expect(out.status).toBe('CONFIRMED');
    // receipt (PAID) + the open invoice for the remaining 100k, both written with the payment.
    expect(await counts()).toEqual({ invoices: 2, holds: 1, status: 'CONFIRMED', frozen: 200_000 });
  });
});
